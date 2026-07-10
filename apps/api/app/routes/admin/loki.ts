import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";

const LOKI_URL = process.env.lokiUrl || "http://127.0.0.1:3100";

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
  // p50/p95/p99 latency (range vector, unwrapping durationMs)
  latency: {
    type: "query_range",
    logql:
      'quantile_over_time(0.50, {job="pm2", msg="request"} | unwrap durationMs [$__interval]),' +
      'quantile_over_time(0.95, {job="pm2", msg="request"} | unwrap durationMs [$__interval]),' +
      'quantile_over_time(0.99, {job="pm2", msg="request"} | unwrap durationMs [$__interval])',
  },
  // Top 10 slowest endpoints (instant vector)
  slowEndpoints: {
    type: "query",
    logql: 'topk(10, avg by (path) (avg_over_time({job="pm2", msg="request"} | unwrap durationMs [1h])))',
  },
  // Endpoints with most 5xx errors (instant vector)
  errorEndpoints: {
    type: "query",
    logql: 'topk(10, sum by (path) (count_over_time({job="pm2", level="error"} [1h])))',
  },
  // Recent error log lines (stream)
  recentErrors: {
    type: "query_range",
    logql: '{job="pm2", level=~"error|warn"}',
  },
};

const router = new Router<Application.DefaultState, Context>();

// GET /api/admin/loki/query/:key — runs a pre-built LogQL query
router.get("/query/:key", async (ctx) => {
  const { key } = ctx.params;
  const query = QUERIES[key];
  if (!query) {
    throw createError(400, `Unknown query key: ${key}`);
  }

  const now = Date.now();
  const start = ctx.query.start ? Number(ctx.query.start) : now - 3600_000; // default: 1h ago
  const end = ctx.query.end ? Number(ctx.query.end) : now;
  const limit = ctx.query.limit ? Math.min(Number(ctx.query.limit), 5000) : 1000;

  const url = new URL(`${LOKI_URL}/loki/api/v1/${query.type}`);
  url.searchParams.set("query", query.logql);
  url.searchParams.set("start", String(Math.floor(start / 1000).toString()));
  url.searchParams.set("end", String(Math.floor(end / 1000).toString()));
  if (query.type === "query_range") {
    url.searchParams.set("limit", String(limit));
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw createError(502, `Loki returned ${res.status}: ${text}`);
    }
    const data = await res.json();
    ctx.body = data;
  } catch (err) {
    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
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
    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      throw createError(503, "Loki is not running");
    }
    throw err;
  }
});

export default router;
