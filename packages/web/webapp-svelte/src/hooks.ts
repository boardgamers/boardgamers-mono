import type { ExternalFetch } from "@sveltejs/kit";
import { extractCookie } from "./utils/extract-cookie";

export type Session = {
  ssr: boolean;
  refreshToken: string | undefined;
};

export function getSession(request: { headers: Record<string, string> }): Session {
  const refreshToken = extractCookie("refreshToken", request.headers.cookie ?? "");
  return {
    ssr: true,
    refreshToken: refreshToken && JSON.parse(refreshToken),
  };
}

export const externalFetch: ExternalFetch = async (request) => {
  console.log(request.url);
  if (request.url.startsWith("http://localhost:3000/api/gameplay")) {
    request = new Request(request.url.replace("http://localhost:3000/", "http://localhost:50803/"), request);
  } else if (request.url.startsWith("http://localhost:3000/api/")) {
    request = new Request(request.url.replace("http://localhost:3000/", "http://localhost:50801/"), request);
  }

  return fetch(request);
};
