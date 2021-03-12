import { get as $ } from "svelte/store";
import type { Token } from "../store";
import { accessToken, gamesAccessToken, refreshToken } from "../store";

const baseUrl = "/api";

function transformUrl(url: string) {
  return url.startsWith("http") || url.startsWith("//") ? url : baseUrl + url;
}

export async function get(url: string) {
  const token = await getAccessToken(url);
  return getResponseData(
    await fetch(transformUrl(url), { headers: token ? { Authorization: `Bearer ${token.code}` } : {} })
  );
}

export async function post(url: string, data: Record<string, unknown> = {}) {
  const token = await getAccessToken(url);

  return getResponseData(
    await fetch(transformUrl(url), {
      method: "POST",
      body: JSON.stringify(data),
      headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token.code}` }) },
    })
  );
}

async function getResponseData(response: Response) {
  const body = response.headers.get("content-type")?.startsWith("application/json")
    ? await response.json()
    : await response.text();

  if (response.status >= 400) {
    throw body;
  }

  return body;
}

/**
 * Get accessToken, generating from refreshToken if needed, with the correct scopes
 * @param url Used to determine the scopes needed for the accessToken
 * @returns Access token or null if logged out
 */
async function getAccessToken(url: string): Promise<Token | null> {
  if (!$(refreshToken)) {
    return null;
  }

  const isGames = url.startsWith("/gameplay");

  const ref = isGames ? gamesAccessToken : accessToken;
  const $ref = $(ref);

  if ($ref && $ref.expiresAt > Date.now() + 5 * 60 * 1000) {
    return $ref;
  }

  const body = await getResponseData(
    await fetch(transformUrl("/account/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: $(refreshToken)!.code, scopes: isGames ? ["gameplay"] : ["all"] }),
    })
  );

  ref.set(body);
  return body;
}
