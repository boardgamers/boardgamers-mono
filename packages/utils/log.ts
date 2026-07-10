/**
 * Structured logging helpers shared across all server processes (api,
 * game-server, web SSR). Dependency-free and stdout/stderr-only so it works
 * everywhere (local dev, Docker, adapter-node) without extra setup. Safe to
 * swap for pino later — call sites won't change.
 *
 *   {"level":"info","msg":"request","method":"GET","path":"/api/account","status":200,"durationMs":12}
 */

type Level = "info" | "warn" | "error";

function levelForStatus(status: number): Level {
  if (status >= 500) {
    return "error";
  }
  if (status >= 400) {
    return "warn";
  }
  return "info";
}

/**
 * Emit a structured log line. Errors go to stderr (so Docker / cluster setups
 * can split streams); info/warn to stdout.
 */
export function logEvent(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ...fields, time: new Date().toISOString() });
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export interface RequestLogContext {
  method: string;
  path: string;
  route?: string;
  status: number;
  durationMs: number;
  ip?: string;
  userId?: string;
  requestId?: string;
  error?: string;
}

/**
 * Extract the parameterized route pattern from a Koa context (e.g.
 * `/api/admin/users/:userId`). koa-router v8's `ctx._matchedRoute` is
 * unreliable with nested routers — it shows the mount-point prefix, not the
 * leaf route. `ctx.matched` contains all matched layers (including middleware
 * mounts), so we find the first layer with actual HTTP methods — that's the
 * most specific route. Falls back to the raw path for unmatched requests (404).
 */
export function matchedRoute(ctx: { matched?: { path: string; methods: string[] }[]; path: string }): string {
  const layer = ctx.matched?.find((l) => l.methods.length > 0);
  return layer?.path ?? ctx.path;
}

/** Log a completed request — used by the Koa middleware in each app. */
export function logRequest(label: string, ctx: RequestLogContext): void {
  logEvent(levelForStatus(ctx.status), "request", { source: label, ...ctx });
}

/** Install process-level sinks so unhandled rejections don't vanish. */
export function installProcessHandlers(label: string): void {
  process.on("unhandledRejection", (reason) => {
    logEvent("error", "unhandledRejection", {
      source: label,
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack?.split("\n") : undefined,
    });
  });
  process.on("uncaughtException", (err) => {
    logEvent("error", "uncaughtException", { source: label, error: err.message, stack: err.stack?.split("\n") });
    // Give the log line time to flush, then exit — a crashed process should not
    // be kept alive serving broken state. In a cluster the primary will re-fork.
    setTimeout(() => process.exit(1), 100);
  });
}
