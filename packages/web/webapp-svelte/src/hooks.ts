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
