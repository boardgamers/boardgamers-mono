import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { REFERER_ORIGIN_RE, REFERER_ORIGIN_RE_LOGQL, refererOrigin } from "./loki.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

// Node's test runner runs spec files in separate processes, so stubbing the
// global fetch here only affects this file's process — the route module picks
// it up at call time. No real Loki is ever contacted.
const lokiUrls: URL[] = [];

function lokiUrlFromRequest(input: string | URL | Request): URL {
	if (typeof input === "string" || input instanceof URL) {
		return new URL(input);
	}
	return new URL(input.url);
}

const lokiOk = () => new Response(JSON.stringify({ status: "success", data: { result: [] } }), { status: 200 });

const realFetch = globalThis.fetch;

describe("Admin Loki proxy", () => {
	let adminHeaders: Record<string, string>;

	before(async () => {
		const adminId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		const tokenDoc = { user: adminId, codeHash: hashRefreshCode(generateRefreshCode()), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], true);
		adminHeaders = { Authorization: `Bearer ${token}` };

		mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
			const url = lokiUrlFromRequest(input);
			if (url.pathname.startsWith("/loki/")) {
				lokiUrls.push(url);
				return lokiOk();
			}
			// Requests to the API server under test go through for real.
			return realFetch(input, init);
		});
	});

	after(async () => {
		mock.restoreAll();
		await db().dropDatabase();
	});

	async function query(key: string, params?: Record<string, string>) {
		lokiUrls.length = 0;
		const search = params ? `?${new URLSearchParams(params)}` : "";
		const res = await fetch(`${baseURL()}/api/admin/loki/query/${key}${search}`, { headers: adminHeaders });
		return { status: res.status, lokiUrl: lokiUrls[0] };
	}

	it("evaluates instant queries at a single timestamp (start === end), not a 1h span", async () => {
		for (const key of ["statusCounts", "slowEndpoints", "errorEndpoints"]) {
			const { status, lokiUrl } = await query(key);
			assert.equal(status, 200, key);
			assert.equal(lokiUrl.pathname, "/loki/api/v1/query");
			assert.equal(lokiUrl.searchParams.get("start"), lokiUrl.searchParams.get("end"), key);
			assert.equal(lokiUrl.searchParams.has("step"), false, key);
			const time = Number(lokiUrl.searchParams.get("time"));
			assert.ok(Number.isFinite(time) && time > 0, `${key}: time=${lokiUrl.searchParams.get("time")}`);
		}
	});

	it("honours the requested end for instant queries", async () => {
		const end = Date.now() - 60_000;
		const { status, lokiUrl } = await query("statusCounts", { end: String(end) });
		assert.equal(status, 200);
		assert.equal(lokiUrl.searchParams.get("time"), String(Math.floor(end / 1000)));
	});

	it("requestsByLanguage is an instant query grouping web requests by lang over 7d", async () => {
		const { status, lokiUrl } = await query("requestsByLanguage");
		assert.equal(status, 200);
		// Instant vector: single-timestamp evaluation (start === end), no step.
		assert.equal(lokiUrl.pathname, "/loki/api/v1/query");
		assert.equal(lokiUrl.searchParams.get("start"), lokiUrl.searchParams.get("end"));
		assert.equal(lokiUrl.searchParams.has("step"), false);
		const logql = lokiUrl.searchParams.get("query") ?? "";
		// Groups by the `lang` field the web request logger emits, over a 7d window,
		// scoped to web requests (the Accept-Language capture lives in the web SSR).
		assert.ok(logql.includes("by (lang)"), logql);
		assert.ok(logql.includes('source="web"'), logql);
		assert.ok(logql.includes("[7d]"), logql);
		assert.ok(logql.includes("| json"), logql);
	});

	it("topReferers groups by referer ORIGIN (host) extracted via label_format, not the full URL", async () => {
		const { status, lokiUrl } = await query("topReferers");
		assert.equal(status, 200);
		// Instant vector: single-timestamp evaluation, no step.
		assert.equal(lokiUrl.pathname, "/loki/api/v1/query");
		assert.equal(lokiUrl.searchParams.get("start"), lokiUrl.searchParams.get("end"));
		assert.equal(lokiUrl.searchParams.has("step"), false);
		const logql = lokiUrl.searchParams.get("query") ?? "";
		assert.ok(logql.includes("topk("), logql);
		assert.ok(logql.includes("by (origin)"), logql);
		assert.ok(!logql.includes("by (referer)"), logql);
		assert.ok(logql.includes('source="web"'), logql);
		assert.ok(logql.includes("[7d]"), logql);
		// Empty referers are excluded so "no header" doesn't dominate the top-N.
		assert.ok(logql.includes('| referer != ""'), logql);
		// The host extraction happens in a label_format stage, with the same regex
		// REFERER_ORIGIN_RE documents (the refererOrigin spec below pins the behavior).
		assert.ok(logql.includes("label_format origin="), logql);
		assert.ok(logql.includes(REFERER_ORIGIN_RE_LOGQL), logql);
		assert.ok(logql.includes('"${1}"'), logql);
		// A leading "www." is stripped for cleaner grouping (other subdomains kept).
		// Spelled "^www[.]" because a backslash-escaped dot would need a double
		// backslash inside the Go template string, which Loki's parser rejects.
		assert.ok(logql.includes('regexReplaceAll "^www[.]"'), logql);
	});

	it("topUserAgents is an instant topk query over web requests (7d)", async () => {
		const { status, lokiUrl } = await query("topUserAgents");
		assert.equal(status, 200);
		// Instant vector: single-timestamp evaluation, no step.
		assert.equal(lokiUrl.pathname, "/loki/api/v1/query");
		assert.equal(lokiUrl.searchParams.get("start"), lokiUrl.searchParams.get("end"));
		assert.equal(lokiUrl.searchParams.has("step"), false);
		const logql = lokiUrl.searchParams.get("query") ?? "";
		assert.ok(logql.includes("topk("), logql);
		assert.ok(logql.includes("by (ua)"), logql);
		assert.ok(logql.includes('source="web"'), logql);
		assert.ok(logql.includes("[7d]"), logql);
		// Empty values are excluded so "no header" doesn't dominate the top-N.
		assert.ok(logql.includes('| ua != ""'), logql);
	});

	it("refererOrigin extracts the host (the regex the LogQL label_format mirrors)", () => {
		// The JS regex literal and the LogQL string spelling must stay equivalent —
		// they differ only in escaping (\/ in the literal vs // in the template).
		assert.equal(REFERER_ORIGIN_RE.source, REFERER_ORIGIN_RE_LOGQL.replaceAll("//", "\\/\\/"));
		// Full URLs → bare host, path/query/fragment dropped.
		assert.equal(refererOrigin("https://boardgamegeek.com/thread/999"), "boardgamegeek.com");
		assert.equal(refererOrigin("https://www.reddit.com/r/boardgames/?q=1#x"), "reddit.com");
		assert.equal(refererOrigin("http://google.com"), "google.com");
		// Only a leading "www." is stripped; other subdomains stay distinct.
		assert.equal(refererOrigin("https://old.reddit.com/r/x"), "old.reddit.com");
		// Ports don't fragment the grouping.
		assert.equal(refererOrigin("http://localhost:8612/games"), "localhost");
		// Scheme-less / malformed referers fall back to the raw value (kept, not dropped).
		assert.equal(refererOrigin("boardgamegeek.com"), "boardgamegeek.com");
		assert.equal(refererOrigin("not a url"), "not a url");
	});

	it("passes a step param and expands $__interval for query_range queries", async () => {
		for (const key of ["requestRate", "errorRate", "latency"]) {
			const { status, lokiUrl } = await query(key);
			assert.equal(status, 200, key);
			assert.equal(lokiUrl.pathname, "/loki/api/v1/query_range");
			const step = Number(lokiUrl.searchParams.get("step"));
			assert.ok(Number.isFinite(step) && step >= 15, `${key}: step=${step}`);
			const logql = lokiUrl.searchParams.get("query") ?? "";
			assert.ok(!logql.includes("$__interval"), `${key}: ${logql}`);
			assert.ok(logql.includes(`[${step}s]`), `${key}: ${logql}`);
		}
	});

	it("coarsens the step for larger windows (~60 points per window)", async () => {
		const end = Date.now();
		const { status, lokiUrl } = await query("requestRate", {
			start: String(end - 3600_000),
			end: String(end),
		});
		assert.equal(status, 200);
		assert.equal(lokiUrl.searchParams.get("step"), "60");
	});

	it("rejects windows larger than 6h with 400", async () => {
		const end = Date.now();
		const { status, lokiUrl } = await query("recentErrors", {
			start: String(end - 7 * 3600_000),
			end: String(end),
		});
		assert.equal(status, 400);
		assert.equal(lokiUrl, undefined, "Loki must not be contacted");
	});

	it("rejects unknown query keys with 400", async () => {
		const { status, lokiUrl } = await query("dropDatabase");
		assert.equal(status, 400);
		assert.equal(lokiUrl, undefined, "Loki must not be contacted");
	});

	it("logsByRequestId substitutes a validated requestId into the LogQL", async () => {
		const requestId = "123e4567-e89b-42d3-a456-426614174000";
		const { status, lokiUrl } = await query("logsByRequestId", { requestId });
		assert.equal(status, 200);
		assert.equal(lokiUrl.pathname, "/loki/api/v1/query_range");
		const logql = lokiUrl.searchParams.get("query") ?? "";
		assert.ok(logql.includes(`requestId="${requestId}"`), logql);
		assert.ok(!logql.includes("$requestId"), logql);
	});

	it("logsByRequestId rejects a missing or malformed requestId without contacting Loki", async () => {
		for (const params of [
			{},
			{ requestId: "not-a-uuid" },
			// LogQL injection attempt: would break out of the quoted matcher
			{ requestId: '123e4567-e89b-42d3-a456-426614174000" | drop' },
		]) {
			const { status, lokiUrl } = await query("logsByRequestId", params);
			assert.equal(status, 400, JSON.stringify(params));
			assert.equal(lokiUrl, undefined, "Loki must not be contacted");
		}
	});
});
