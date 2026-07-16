import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, type Token } from "./auth.svelte";

const BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function getResponseData<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type");
  const body = contentType?.startsWith("application/json") ? await response.json() : await response.text();

  if (response.status >= 400) {
    throw new ApiError((body as any)?.message ?? String(body), response.status);
  }

  return body as T;
}

function scopesFor(url: string): string[] {
  if (url.startsWith("/gameplay")) return ["gameplay"];
  if (url.startsWith("ws")) return ["site"];
  return ["all"];
}

export interface ApiContext {
  /** SSR-aware fetch (event.fetch on the server, global fetch on the client). */
  fetch: typeof fetch;
  /** Client IP to forward as X-Real-IP (server only). */
  ip?: string;
}

let context: ApiContext = { fetch: globalThis.fetch };

/** Set the API context for the current render cycle (called from +layout). */
export function setApiContext(ctx: ApiContext | ((prev: ApiContext) => ApiContext)) {
  context = typeof ctx === "function" ? ctx(context) : ctx;
}

async function getAccessTokenFor(url: string): Promise<Token | null> {
  const scopes = scopesFor(url);
  const key = scopes.join(",");

  const existing = getAccessToken(key);
  if (existing && existing.expiresAt > Date.now() + 5 * 60 * 1000) {
    return existing;
  }

  const refresh = getRefreshToken();
  if (!refresh) return null;

  const res = await context.fetch(`${BASE}/account/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(context.ip && { "X-Real-IP": context.ip }) },
    body: JSON.stringify({ code: refresh.code, scopes }),
  });

  if (res.status === 404) {
    clearTokens();
    return null;
  }

  const token = await getResponseData<Token>(res);
  setAccessToken(key, token);
  return token;
}

function transformUrl(url: string) {
  return url.startsWith("http") || url.startsWith("//") ? url : BASE + url;
}

export async function get<T>(url: string, query?: Record<string, unknown> | URLSearchParams): Promise<T> {
  const token = await getAccessTokenFor(url);
  const qs = query ? "?" + new URLSearchParams(query as Record<string, string>).toString() : "";
  return getResponseData<T>(
    await context.fetch(transformUrl(url) + qs, {
      headers: {
        ...(context.ip && { "X-Real-IP": context.ip }),
        ...(token && { Authorization: `Bearer ${token.code}` }),
      },
    })
  );
}

export async function post<T>(url: string, data: Record<string, unknown> = {}): Promise<T> {
  const token = await getAccessTokenFor(url);
  return getResponseData<T>(
    await context.fetch(transformUrl(url), {
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-Type": "application/json",
        ...(context.ip && { "X-Real-IP": context.ip }),
        ...(token && { Authorization: `Bearer ${token.code}` }),
      },
    })
  );
}

export async function apiFetch(url: string, options: RequestInit): Promise<Response> {
  const token = await getAccessTokenFor(url);
  return context.fetch(transformUrl(url), {
    ...options,
    headers: {
      ...options.headers,
      ...(context.ip && { "X-Real-IP": context.ip }),
      ...(token && { Authorization: `Bearer ${token.code}` }),
    },
  });
}

// The websocket layer needs raw token access
export { getRefreshToken as getRefreshTokenRaw, clearTokens };
