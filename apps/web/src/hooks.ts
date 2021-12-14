import type { ExternalFetch } from "@sveltejs/kit";
import { extractCookie } from "./utils/extract-cookie";

export type Session = {
  ssr: boolean;
  host: string;
  refreshToken: string | undefined;
  sidebarOpen: boolean | undefined;
};

export function getSession(request: { headers: Record<string, string> }): Session {
  const refreshToken = extractCookie("refreshToken", request.headers.cookie ?? "");
  const sidebarOpen = extractCookie("sidebarOpen", request.headers.cookie ?? "");

  return {
    ssr: true, // Tell the frontend that it's not just a SPA, there was SSR involved
    host: request.headers.host,
    refreshToken: refreshToken && JSON.parse(refreshToken),
    sidebarOpen: sidebarOpen && JSON.parse(sidebarOpen),
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
    request = new Request(request.url.replace(host, "http://localhost:50803"), request);
  } else if (path.startsWith("/api/")) {
    request = new Request(request.url.replace(host, "http://localhost:50801"), request);
  }

  return fetch(request);
};
