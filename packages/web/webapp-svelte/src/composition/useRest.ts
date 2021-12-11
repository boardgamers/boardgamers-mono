import { get as $ } from "svelte/store";
import { defineStore } from "./defineStore";
import { useAccessTokens } from "./useAccessTokens";
import type { Token } from "./useRefreshToken";
import { useRefreshToken } from "./useRefreshToken";
import { useSession } from "./useSession";

// todo : do not use hardcoded values
// using an "external" url is needed to trigger externalFetch
// & hydrating the content instead of making two requests
const baseUrl = "http://localhost:3000/api";

async function getResponseData<T>(response: Response): Promise<T> {
  const body = response.headers.get("content-type")?.startsWith("application/json")
    ? await response.json()
    : await response.text();

  if (response.status >= 400) {
    const err = new Error(body);

    (err as any).status = response.status;
    throw err;
  }

  return body;
}

function transformUrl(url: string) {
  return url.startsWith("http") || url.startsWith("//") ? url : baseUrl + url;
}

export const useRest = defineStore(() => {
  const fetch = useSession().data.fetch;
  const refreshToken = useRefreshToken();
  const accessTokens = useAccessTokens();

  function setAccessToken(token: Token | null, scopes: string[] = ["all"]): void {
    if (token) {
      accessTokens.set({ ...$(accessTokens), [scopes.join(",")]: token });
    } else {
      delete $(accessTokens)[scopes.join(",")];
      accessTokens.set({ ...$(accessTokens) });
    }
  }

  /**
   * Get accessToken, generating from refreshToken if needed, with the correct scopes
   * @param url Used to determine the scopes needed for the accessToken
   * @returns Access token or null if logged out
   */
  async function getAccessToken(url: string): Promise<Token | null> {
    const $refreshToken = $(refreshToken);

    if (!$refreshToken) {
      return null;
    }

    let scopes = ["all"];

    if (url.startsWith("/gameplay")) {
      scopes = ["gameplay"];
    } else if (url.startsWith("ws")) {
      scopes = ["site"];
    }

    const accessToken = $(accessTokens)[scopes.join(",")];

    if (accessToken?.expiresAt > Date.now() + 5 * 60 * 1000) {
      return accessToken;
    }

    const response = await fetch(transformUrl("/account/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: $refreshToken.code, scopes }),
    });

    if (response.status === 404) {
      refreshToken.set(null);
      return null;
    }
    const body = await getResponseData<Token>(response);

    setAccessToken(body, scopes);

    return body;
  }

  async function get<T>(url: string, query?: Record<string, unknown>): Promise<T> {
    const token = await getAccessToken(url);
    return getResponseData<T>(
      await fetch(
        transformUrl(url) + (query ? "?" + new URLSearchParams(query as Record<string, string>).toString() : ""),
        {
          headers: { ...(token && { Authorization: `Bearer ${token.code}` }) },
        }
      )
    );
  }

  async function post<T>(url: string, data: Record<string, unknown> = {}): Promise<T> {
    const token = await getAccessToken(url);

    return getResponseData<T>(
      await fetch(transformUrl(url), {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token.code}` }) },
      })
    );
  }

  return { get, post, getAccessToken, setAccessToken };
});
