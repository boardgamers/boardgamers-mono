import { browser } from "$app/environment";
import { extractCookie } from "@/utils/extract-cookie";

export type Token = { code: string; expiresAt: number };

export type AuthData = {
  user: import("@bgs/models").UserFront;
  accessToken: Token;
  refreshToken: Token;
};

// Module-level singletons. On the client these survive navigations (what we
// want for websocket state + token caching). On the server each request gets a
// fresh module instance per worker, and the real per-request state lives on
// event.locals — these stores are only read client-side during hydration.

let refreshToken: Token | null = null;
const accessTokens: Record<string, Token> = {};

/** Initialize the client-side token state from cookies (called once on startup). */
export function initTokens() {
  if (browser && refreshToken === null) {
    refreshToken = extractCookie("refreshToken", document.cookie) ?? null;
    // Normalize string expiresAt from older cookies
    if (refreshToken && typeof refreshToken.expiresAt === "string") {
      refreshToken = { ...refreshToken, expiresAt: new Date(refreshToken.expiresAt).getTime() };
    }
  }
}

/** Seed the refresh token from SSR layout data or a login response. */
export function setRefreshToken(token: Token | null) {
  refreshToken = token;
  if (browser) {
    if (token) {
      const maxAge = Math.max(0, Math.floor((token.expiresAt - Date.now()) / 1000));
      document.cookie = `refreshToken=${JSON.stringify(token)}; Max-Age=${maxAge}; Path=/; SameSite=Lax; Secure`;
      scheduleExpiry(token);
    } else {
      document.cookie = `refreshToken=null; path=/; expires=${new Date(0).toUTCString()}; SameSite=Lax; Secure`;
    }
  }
}

export function getRefreshToken(): Token | null {
  return refreshToken;
}

export function getAccessToken(scope: string): Token | undefined {
  return accessTokens[scope];
}

export function setAccessToken(scope: string, token: Token): void {
  accessTokens[scope] = token;
}

export function setAccessTokens(tokens: Record<string, Token>): void {
  for (const [key, val] of Object.entries(tokens)) accessTokens[key] = val;
}

export function clearTokens(): void {
  refreshToken = null;
  for (const key of Object.keys(accessTokens)) delete accessTokens[key];
  if (browser) {
    document.cookie = `refreshToken=null; path=/; expires=${new Date(0).toUTCString()}; SameSite=Lax; Secure`;
  }
}

let expiryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleExpiry(token: Token) {
  clearTimeout(expiryTimer);
  const delay = token.expiresAt - Date.now() + 10;
  if (delay > 0) {
    expiryTimer = setTimeout(() => {
      if (refreshToken && refreshToken.expiresAt < Date.now()) {
        setRefreshToken(null);
      }
    }, delay);
  }
}

/** Set all auth data after a login/signup/social-auth callback. */
export function setAuthData(data: AuthData) {
  setRefreshToken(data.refreshToken);
  setAccessToken("all", data.accessToken);
}

/** Full auth response including the user object. */
export function setFullAuthData(data: AuthData) {
  setAuthData(data);
}
