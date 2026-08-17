import { error } from "@sveltejs/kit";

const BASE = "/api";

/**
 * Resolve the right fetch for the current execution context.
 *
 * On the server (inside a request — SSR `load`, action, endpoint, or any async helper
 * they call), this returns the current request's `event.fetch` via `getRequestEvent()`
 * (AsyncLocalStorage — the context propagates across `await`, and each concurrent
 * request has its own, so there's no cross-request leak). `event.fetch` handles relative
 * URLs and forwards the session cookie to the API (via `handleFetch`).
 *
 * In the browser, or outside a request (websocket, prerender, etc.), `getRequestEvent()`
 * throws — so we fall back to the shared context fetch (the browser's native fetch,
 * where the cookie is sent automatically by the browser).
 *
 * On the server, `getRequestEvent().fetch` comes from `./api.server` (a `.server` module
 * SvelteKit strips from the client bundle); `import.meta.env.SSR` is a compile-time
 * constant so the dynamic import is dead-code-eliminated in the browser build.
 */
async function requestFetch(): Promise<typeof fetch> {
	if (!import.meta.env.SSR) {
		return context.fetch;
	}
	const { currentEventFetch } = await import("./api.server");
	return currentEventFetch() ?? context.fetch;
}

/**
 * Whether a session cookie is available to the current execution context, so
 * cookie-authed calls (mint) can be skipped instead of 401-ing for anonymous
 * visitors. In the browser the session cookie is httpOnly (invisible to JS),
 * so the client is seeded once at login/logout via `setClientSessionKnown`;
 * on the server the current request's cookie is read via `getRequestEvent()`.
 * Outside a request (prerender, websocket, …) there is no cookie to read —
 * return true and let the call 401 → null as before.
 */
let clientSessionKnown = false;

/** Seed the client-side session flag from the SSR layout's `user` (login/logout re-seed). */
export function setClientSessionKnown(known: boolean): void {
	clientSessionKnown = known;
}

async function hasSession(): Promise<boolean> {
	if (!import.meta.env.SSR) {
		return clientSessionKnown;
	}
	const { currentRequestHasSession } = await import("./api.server");
	return currentRequestHasSession();
}

export class ApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

/**
 * Convert a failed api call into SvelteKit's `error()` so a `load` renders the error
 * page with the api's status instead of a generic 500: an `ApiError` (any api response
 * >= 400) keeps its status and message; anything else becomes a 500.
 *
 * Use as `.catch(toKitError)` on a `get()`/`post()` inside a load function — or call
 * `toKitError(err, fallbackMessage)` to override the message. Re-throwing the ApiError
 * itself would make SvelteKit turn it into a 500 regardless of its actual status.
 */
export function toKitError(err: unknown, fallbackMessage = "Request failed"): never {
	if (err instanceof ApiError) {
		throw error(err.status, err.message);
	}
	throw error(500, err instanceof Error ? err.message : fallbackMessage);
}

export type Token = { code: string; expiresAt: number };

async function getResponseData<T>(response: Response): Promise<T> {
	const contentType = response.headers.get("content-type");
	const body = contentType?.startsWith("application/json") ? await response.json() : await response.text();

	if (response.status >= 400) {
		throw new ApiError((body as any)?.message ?? String(body), response.status);
	}

	return body as T;
}

/**
 * Shared fallback fetch (the browser's native fetch; also the SSR fallback when
 * `getRequestEvent()` has no request — prerender, websocket, etc.). Per-request SSR
 * fetches resolve `event.fetch` via `requestFetch()` instead, so nothing per-request
 * is ever written to this module-level value.
 */
const context = { fetch: globalThis.fetch };

function transformUrl(url: string) {
	return url.startsWith("http") || url.startsWith("//") ? url : BASE + url;
}

/**
 * Game-server calls (/gameplay/*) authenticate with a minted "gameplay"-scoped bearer
 * token — the game-server verifies JWTs by public key only and has no session/cookie
 * access. All other API calls use the session cookie (sent automatically).
 */
async function authHeaderFor(url: string, fetchFn: typeof fetch): Promise<Record<string, string>> {
	if (!url.startsWith("/gameplay")) {
		return {};
	}
	const token = await mintToken("gameplay", fetchFn).catch(() => null);
	return token ? { Authorization: `Bearer ${token.code}` } : {};
}

export interface FetchOptions {
	/**
	 * Per-request fetch override. On the server, pass `event.fetch` — it inherits the
	 * request's cookie for same-origin /api calls, so the API resolves the session
	 * itself with no shared token state (request-scoped, leak-safe). Defaults to the
	 * shared context fetch (browser / public SSR data).
	 */
	fetch?: typeof fetch;
}

export async function get<T>(
	url: string,
	query?: Record<string, unknown> | URLSearchParams,
	opts?: FetchOptions,
): Promise<T> {
	const doFetch = opts?.fetch ?? (await requestFetch());
	const qs = query ? "?" + new URLSearchParams(query as Record<string, string>).toString() : "";
	return getResponseData<T>(
		await doFetch(transformUrl(url) + qs, {
			credentials: "same-origin",
			headers: await authHeaderFor(url, doFetch),
		}),
	);
}

export async function post<T>(url: string, data: Record<string, unknown> = {}, opts?: FetchOptions): Promise<T> {
	const doFetch = opts?.fetch ?? (await requestFetch());
	return getResponseData<T>(
		await doFetch(transformUrl(url), {
			method: "POST",
			credentials: "same-origin",
			body: JSON.stringify(data),
			headers: { "Content-Type": "application/json", ...(await authHeaderFor(url, doFetch)) },
		}),
	);
}

export async function apiFetch(url: string, options: RequestInit, opts?: FetchOptions): Promise<Response> {
	const doFetch = opts?.fetch ?? (await requestFetch());
	return doFetch(transformUrl(url), {
		credentials: "same-origin",
		...options,
		headers: { ...options.headers, ...(await authHeaderFor(url, doFetch)) },
	});
}

/**
 * Mint a short-lived, narrowly-scoped access token (e.g. "gameplay" for the
 * game-server, "site" for the websocket). Auth is via the session cookie — no refresh
 * token is handled in JS. Cached per scope until near expiry.
 */
const mintedTokens: Record<string, Token> = {};

export async function mintToken(scope: string, fetchFn?: typeof fetch): Promise<Token | null> {
	const existing = mintedTokens[scope];
	if (existing && existing.expiresAt > Date.now() + 5 * 60 * 1000) {
		return existing;
	}

	// No session cookie → the mint would 401. Skip the roundtrip entirely;
	// callers already treat a null token as "not logged in".
	if (!(await hasSession())) {
		delete mintedTokens[scope];
		return null;
	}

	const doFetch = fetchFn ?? (await requestFetch());
	const res = await doFetch(`${BASE}/account/mint`, {
		method: "POST",
		credentials: "same-origin",
		body: JSON.stringify({ scopes: [scope] }),
		headers: { "Content-Type": "application/json" },
	});

	if (res.status === 401 || res.status === 404) {
		delete mintedTokens[scope];
		return null; // not logged in
	}

	const token = await getResponseData<Token>(res);
	mintedTokens[scope] = token;
	return token;
}

export function clearMintedTokens(): void {
	for (const key of Object.keys(mintedTokens)) delete mintedTokens[key];
}
