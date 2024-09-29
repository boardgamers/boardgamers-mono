import { get as $ } from "svelte/store";
import { defineStore } from "./defineStore";
import { useAccessTokens } from "./useAccessTokens";
import type { Token } from "./useRefreshToken";
import { useRefreshToken } from "./useRefreshToken";
import { useSession } from "./useSession";

async function getResponseData<T>(response: Response): Promise<T> {
  const body = response.headers.get("content-type")?.startsWith("application/json")
    ? await response.json()
    : await response.text();

  if (response.status >= 400) {
    const err = new Error(body?.message ?? body);

    Object.assign(err, { status: response.status });
    throw err;
  }

  return body;
}

export const useRest = defineStore(() => {
  const { session, data } = useSession();
  const fetch = data.fetch;
  const { refreshToken } = useRefreshToken();
  const accessTokens = useAccessTokens();
  const ip = session.ip;

  // We use external fetch
  const baseUrl = session.host.startsWith("localhost") ? `http://${session.host}/api` : `https://${session.host}/api`;

  function transformUrl(url: string) {
    return url.startsWith("http") || url.startsWith("//") ? url : baseUrl + url;
  }

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
      headers: { "Content-Type": "application/json", "X-Real-IP": ip },
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

  async function get<T>(url: string, query?: Record<string, unknown> | URLSearchParams): Promise<T> {
    const token = await getAccessToken(url);
    return getResponseData<T>(
      await fetch(
        transformUrl(url) + (query ? "?" + new URLSearchParams(query as Record<string, string>).toString() : ""),
        {
          headers: { "X-Real-IP": ip, ...(token && { Authorization: `Bearer ${token.code}` }) },
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
        headers: {
          "Content-Type": "application/json",
          "X-Real-IP": ip,
          ...(token && { Authorization: `Bearer ${token.code}` }),
        },
      })
    );
  }

  async function apiFetch(url: string, options: RequestInit) {
    const token = await getAccessToken(url);

    return await fetch(transformUrl(url), {
      ...options,
      headers: {
        ...options.headers,
        "X-Real-IP": ip,
        ...(token && { Authorization: `Bearer ${token.code}` }),
      },
    });
  }

  return { get, post, fetch: apiFetch, getAccessToken, setAccessToken };
});
