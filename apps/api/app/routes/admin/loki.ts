import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import env from "../../config/env.ts";

const LOKI_URL = env.lokiUrl;

// Node 18+ wraps network failures from fetch() as TypeError("fetch failed") with
// the real cause (ECONNREFUSED, ENOTFOUND, …) on err.cause. Check both layers.
function isLokiDown(err: unknown): boolean {
	if (!(err instanceof Error)) {
		return false;
	}
	if (err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed")) {
		return true;
	}
	const cause = (err as { cause?: unknown }).cause;
	return cause instanceof Error && /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(cause.message);
}

// Pre-built LogQL queries for the admin health dashboard. The admin panel
// never sends raw LogQL — it picks a key from this map and the server adds
// time bounds. This keeps the proxy read-only and prevents LogQL injection.
const QUERIES: Record<string, { type: "query" | "query_range"; logql: string }> = {
	// Status code distribution (instant vector — last value in range)
	statusCounts: {
		type: "query",
		logql: 'sum by (status) (count_over_time({job="pm2", msg="request"}[1h]))',
	},
	// Request rate per source (range vector)
	requestRate: {
		type: "query_range",
		logql: 'sum by (source) (rate({job="pm2", msg="request"}[$__interval]))',
	},
	// Error rate per source (range vector)
	errorRate: {
		type: "query_range",
		logql: 'sum by (source) (rate({job="pm2", level=~"error|warn"}[$__interval]))',
	},
	// Avg latency by source (range vector, unwrapping durationMs). Loki 3.0 needs
	// | json before unwrap so it parses the log line's JSON to find the field.
	latency: {
		type: "query_range",
		logql: 'avg by (source) (avg_over_time({job="pm2", msg="request"} | json | unwrap durationMs [$__interval]))',
	},
	// Top 10 slowest endpoints by parameterized route (instant vector)
	slowEndpoints: {
		type: "query",
		logql: 'topk(10, avg by (route) (avg_over_time({job="pm2", msg="request"} | json | unwrap durationMs [1h])))',
	},
	// Endpoints with most errors (4xx except 401, and 5xx), grouped by parameterized route
	errorEndpoints: {
		type: "query",
		logql:
			'topk(10, sum by (route) (count_over_time({job="pm2", msg="request"} | json | status =~ "[45][0-9][0-9]" | status != 401 [1h])))',
	},
	// Recent error log lines (stream), excluding routine 401 auth checks
	recentErrors: {
		type: "query_range",
		logql: '{job="pm2", level=~"error|warn"} | json | status != 401',
	},
	// Every log line tied to one request: the msg="request" access line, any
	// msg="upstream" lines, and warn/error lines. $requestId is substituted from
	// the validated `requestId` query param (see REQUEST_ID_RE below).
	logsByRequestId: {
		type: "query_range",
		logql: '{job="pm2"} | json | requestId="$requestId"',
	},
	// Preferred-language distribution of web requests over the last week (instant
	// vector). The web SSR logs each request's primary Accept-Language subtag as
	// `lang` (apps/web/src/lib/accept-language.ts); `| json` surfaces it. Feeds the
	// admin users page's i18n-prioritization section. Instant type so the 7d
	// lookback evaluates at a single timestamp (the 6h MAX_WINDOW_MS cap applies
	// only to query_range).
	requestsByLanguage: {
		type: "query",
		logql: 'sum by (lang) (count_over_time({job="pm2", msg="request", source="web"} | json [7d]))',
	},
	// Top referers (where web traffic comes from) over the last week. Empty referers
	// (direct/navigations) are excluded. The web SSR logs the raw Referer header as
	// `referer` (#313); grouped as-is (full URL) — noisy long tails simply don't make
	// the top-N. Instant vector → single-timestamp eval (see requestsByLanguage).
	topReferers: {
		type: "query",
		logql:
			'topk(15, sum by (referer) (count_over_time({job="pm2", msg="request", source="web"} | json | referer != "" [7d])))',
	},
	// Top user-agents over the last week — lets the admin spot scrapers/bots vs real
	// browsers. The web SSR logs a bounded User-Agent as `ua` (#313).
	topUserAgents: {
		type: "query",
		logql: 'topk(15, sum by (ua) (count_over_time({job="pm2", msg="request", source="web"} | json | ua != "" [7d])))',
	},
};

// Hard cap on the queried window. Instant queries below always collapse to a
// single timestamp, but query_range queries (recentErrors …) scan every log
// line in the window — an unbounded start→end span can hammer Loki.
const MAX_WINDOW_MS = 6 * 3600_000;

// Coarse step for query_range requests so Loki doesn't auto-pick a too-fine
// one (~60 points per window, never below 15s).
function computeStepSeconds(start: number, end: number): number {
	return Math.max(15, Math.round((end - start) / 1000 / 60));
}

// Request ids are UUIDs (randomUUID() in the api/game-server/web layers), with
// an x-request-id header able to supply one. Anything outside this strict
// shape is rejected BEFORE it can reach the LogQL string — LogQL injection-safe.
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = new Router<Application.DefaultState, Context>();

// GET /api/admin/loki/query/:key — runs a pre-built LogQL query
router.get("/query/:key", async (ctx) => {
	const { key } = ctx.params;
	const query = QUERIES[key];
	if (!query) {
		throw createError(400, `Unknown query key: ${key}`);
	}

	const now = Date.now();
	let start = ctx.query.start ? Number(ctx.query.start) : now - 3600_000; // default: 1h ago
	const end = ctx.query.end ? Number(ctx.query.end) : now;
	const limit = ctx.query.limit ? Math.min(Number(ctx.query.limit), 5000) : 1000;

	if (end - start > MAX_WINDOW_MS) {
		throw createError(400, "Time range too large: start→end must be at most 6h");
	}

	const url = new URL(`${LOKI_URL}/loki/api/v1/${query.type}`);
	let logql = query.logql;

	if (logql.includes("$requestId")) {
		const requestId = ctx.query.requestId;
		if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
			throw createError(400, "requestId must be a UUID");
		}
		logql = logql.replaceAll("$requestId", requestId);
	}

	if (query.type === "query") {
		// Instant queries: the LogQL already carries its lookback ([1h]), so the
		// request must evaluate at a SINGLE timestamp. Passing a start→end span
		// makes Loki recompute the whole `| json | unwrap` scan at every step
		// across the window — 30–60× the intended work.
		start = end;
		url.searchParams.set("time", String(Math.floor(end / 1000)));
	} else {
		// $__interval is a Grafana macro — Loki never expands it and rejects the
		// query. Substitute the computed step ourselves and pass it explicitly.
		const step = computeStepSeconds(start, end);
		logql = logql.replaceAll("$__interval", `${step}s`);
		url.searchParams.set("start", String(Math.floor(start / 1000)));
		url.searchParams.set("end", String(Math.floor(end / 1000)));
		url.searchParams.set("step", String(step));
		url.searchParams.set("limit", String(limit));
	}
	url.searchParams.set("query", logql);

	try {
		const res = await fetch(url);
		if (!res.ok) {
			const text = await res.text();
			throw createError(502, `Loki returned ${res.status}: ${text}`);
		}
		const data = await res.json();
		ctx.body = data;
	} catch (err) {
		if (isLokiDown(err)) {
			throw createError(503, "Loki is not running");
		}
		throw err;
	}
});

// GET /api/admin/loki/labels — list available labels (for debugging)
router.get("/labels", async (ctx) => {
	try {
		const res = await fetch(`${LOKI_URL}/loki/api/v1/labels`);
		if (!res.ok) {
			throw createError(502, `Loki returned ${res.status}`);
		}
		ctx.body = await res.json();
	} catch (err) {
		if (isLokiDown(err)) {
			throw createError(503, "Loki is not running");
		}
		throw err;
	}
});

export default router;
