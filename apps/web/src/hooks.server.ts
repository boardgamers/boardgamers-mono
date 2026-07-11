import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Handle, HandleFetch } from "@sveltejs/kit";
import { logEvent } from "@bgs/utils/log";
import { extractCookie } from "@/utils/extract-cookie";

interface RequestContext {
  requestId: string;
  clientIp: string | undefined;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const handle: Handle = async ({ event, resolve }) => {
  const clientIp = event.getClientAddress();
  const requestId = event.request.headers.get("x-request-id") || randomUUID();

  // Populate locals from cookies + request — this replaces the old getSession hook.
  const refreshToken = extractCookie("refreshToken", event.request.headers.get("cookie") ?? "") ?? null;
  const sidebarOpen = extractCookie("sidebarOpen", event.request.headers.get("cookie") ?? "");

  event.locals.ip = clientIp;
  event.locals.host = event.url.host;
  event.locals.refreshToken = refreshToken;
  event.locals.sidebarOpen = sidebarOpen;

  return requestContextStorage.run({ requestId, clientIp }, async () => {
    const start = Date.now();
    const path = event.url.pathname;

    let response;
    try {
      response = await resolve(event);
    } catch (err) {
      logEvent("error", "ssr", {
        source: "web",
        method: event.request.method,
        path,
        requestId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.split("\n") : undefined,
      });
      throw err;
    }

    const durationMs = Date.now() - start;
    const status = response.status;
    logEvent(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", {
      source: "web",
      method: event.request.method,
      path,
      status,
      durationMs,
      requestId,
    });

    response.headers.set("x-request-id", requestId);
    return response;
  });
};

/**
 * During SSR, event.fetch calls are routed through here. We rewrite /api/*
 * URLs to the backend host (same logic as the old externalFetch hook, minus the
 * null-body-status workaround which is no longer needed in modern SvelteKit).
 */
export const handleFetch: HandleFetch = async ({ request, fetch, event }) => {
  const ctx = requestContextStorage.getStore();
  const path = new URL(request.url).pathname;

  const backend = path.startsWith("/api/gameplay")
    ? (import.meta.env.VITE_backend ?? "http://127.0.0.1:50803")
    : path.startsWith("/api/")
      ? (import.meta.env.VITE_backend ?? "http://127.0.0.1:50801")
      : null;

  if (backend) {
    request = new Request(request.url.replace(event.url.origin, backend), request);
    if (ctx) {
      request.headers.set("x-request-id", ctx.requestId);
      if (ctx.clientIp) {
        const existing = request.headers.get("x-forwarded-for");
        request.headers.set("x-forwarded-for", existing ? `${existing}, ${ctx.clientIp}` : ctx.clientIp);
      }
    }
  }

  const response = await fetch(request);
  if (!response.ok) {
    logEvent(response.status >= 500 ? "error" : "warn", "upstream", {
      source: "web",
      path,
      status: response.status,
      requestId: ctx?.requestId,
    });
  }
  return response;
};
