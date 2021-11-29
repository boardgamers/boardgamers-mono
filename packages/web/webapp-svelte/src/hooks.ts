import { extractCookie } from "./utils/extract-cookie";

export function getSession(request: { headers: Record<string, string> }): { refreshToken: string | undefined } {
  const refreshToken = extractCookie("refreshToken", request.headers.cookie ?? "");
  return {
    refreshToken: refreshToken && JSON.parse(refreshToken),
  };
}
