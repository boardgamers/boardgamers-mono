import type { ExternalFetch, Handle } from "@sveltejs/kit";
import type { ServerResponse } from "@sveltejs/kit/types/hooks";
import { logEvent } from "@bgs/utils/log";
import { extractCookie } from "./utils/extract-cookie";

export type Session = {
  ip: string;
  ssr: boolean;
  host: string;
  refreshToken: string | undefined;
  sidebarOpen: boolean | undefined;
};

export function getSession(request: { headers: Record<string, string> }): Session {
  const refreshToken = extractCookie("refreshToken", request.headers.cookie ?? "");
  const sidebarOpen = extractCookie("sidebarOpen", request.headers.cookie ?? "");

  return {
    ip: request.headers["x-real-ip"],
    ssr: true, // Tell the frontend that it's not just a SPA, there was SSR involved
    host: request.headers.host,
    refreshToken,
    sidebarOpen,
  };
}

/**
 * WORKAROUND (see WORKAROUNDS.md): our pinned SvelteKit mangles multiline
 * attribute values when serializing the SSR HTML. We patch the `<meta
 * name="description">` tag back to using real newlines.
 */
export async function handle({ request, resolve }: Parameters<Handle>[0]): Promise<ServerResponse> {
  const start = Date.now();
  const path = request.url.pathname;
  let response: ServerResponse;
  try {
    response = await resolve(request);
  } catch (err) {
    logEvent("error", "ssr", {
      source: "web",
      method: request.method,
      path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n") : undefined,
    });
    throw err;
  }

  const durationMs = Date.now() - start;
  const status = response.status;
  logEvent(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", {
    source: "web",
    method: request.method,
    path,
    status,
    durationMs,
  });

  let body = response.body;
  if (typeof body === "string") {
    const start = body.indexOf('<meta name="description"');
    const end = body.indexOf(">", start);
    if (start !== -1 && end !== -1 && body.indexOf("\\n", start) < end) {
      body = body.slice(0, start) + body.slice(start, end).replaceAll("\\n", "\n") + body.slice(end);
    }
  }

  return {
    ...response,
    body,
  };
}

/**
 * HTTP statuses that the Fetch spec forbids from carrying a body ("null body
 * status"): https://fetch.spec.whatwg.org/#null-body-status
 */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/**
 * Our pinned (ancient) version of SvelteKit serializes every SSR `fetch` into a
 * `<script data-type="svelte-data">` tag and rehydrates it on the client with
 * `new Response(body, { status, ... })`. Modern browsers / Node now enforce the
 * Fetch spec, which makes `new Response(<body>, { status: 204 | 304 | ... })`
 * throw "Response body is given with a null body status".
 *
 * Until the SvelteKit migration happens, normalize any null-body status into a
 * plain body-less 200 so the rehydrated `new Response` stays spec-legal. Callers
 * in `useRest` only branch on `status >= 400` and otherwise read the (empty)
 * body, so this is behaviourally transparent for them.
 */
function normalizeNullBodyStatus(response: Response): Response {
  if (!NULL_BODY_STATUSES.has(response.status)) {
    return response;
  }

  const headers = new Headers(response.headers);
  // The original content-length (if any) no longer matches the empty body.
  headers.delete("content-length");

  return new Response(null, { status: 200, statusText: "OK", headers });
}

export const externalFetch: ExternalFetch = async (request) => {
  const delimiter = request.url.slice(8).indexOf("/");

  if (delimiter === -1) {
    return normalizeNullBodyStatus(await fetch(request));
  }

  const host = request.url.slice(0, delimiter + 8);
  const path = request.url.slice(delimiter + 8);

  if (path.startsWith("/api/gameplay")) {
    request = new Request(
      request.url.replace(
        host,
        (import.meta.env as unknown as Record<string, string>).VITE_backend ?? "http://localhost:50803"
      ),
      request
    );
  } else if (path.startsWith("/api/")) {
    request = new Request(
      request.url.replace(
        host,
        (import.meta.env as unknown as Record<string, string>).VITE_backend ?? "http://localhost:50801"
      ),
      request
    );
  }

  const response = await fetch(request);
  if (!response.ok) {
    logEvent(response.status >= 500 ? "error" : "warn", "upstream", {
      source: "web",
      path,
      status: response.status,
    });
  }
  return normalizeNullBodyStatus(response);
};
