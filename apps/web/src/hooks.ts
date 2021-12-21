import type { ExternalFetch, Handle } from "@sveltejs/kit";
import type { ServerResponse } from "@sveltejs/kit/types/hooks";
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
 * Horrible hack to fix SvelteKit's lack of handling of multiline attributes.
 */
export async function handle({ request, resolve }: Parameters<Handle>[0]): Promise<ServerResponse> {
  const response = await resolve(request);

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

export const externalFetch: ExternalFetch = async (request) => {
  const delimiter = request.url.slice(8).indexOf("/");

  if (delimiter === -1) {
    return fetch(request);
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

  return fetch(request);
};
