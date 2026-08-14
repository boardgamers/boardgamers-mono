const BASE = "/api";

export class ApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

type Token = { code: string; expiresAt: number };

/**
 * Mint a short-lived, narrowly-scoped access token (e.g. "gameplay" for the
 * game-server, which verifies JWTs by public key only). Auth is via the session
 * cookie — no refresh token is handled in JS, same as the web app
 * (apps/web/src/lib/api.ts). Cached per scope until near expiry.
 */
const mintedTokens: Record<string, Token> = {};

async function mintToken(scope: string): Promise<Token | null> {
	const existing = mintedTokens[scope];
	if (existing && existing.expiresAt > Date.now() + 5 * 60 * 1000) {
		return existing;
	}

	const res = await fetch(`${BASE}/account/mint`, {
		method: "POST",
		credentials: "same-origin",
		body: JSON.stringify({ scopes: [scope] }),
		headers: { "Content-Type": "application/json" },
	});

	if (res.status === 401 || res.status === 404) {
		delete mintedTokens[scope];
		return null; // not logged in
	}
	if (!res.ok) {
		return null;
	}

	const token: Token = await res.json();
	mintedTokens[scope] = token;
	return token;
}

export function clearMintedTokens(): void {
	for (const key of Object.keys(mintedTokens)) {
		delete mintedTokens[key];
	}
}

/**
 * The main API authenticates via the session cookie (sent automatically, incl. by the
 * server-side /api proxy). Only game-server calls (/api/gameplay/*) need a bearer
 * token — minted "gameplay"-scoped, same as the web app.
 */
async function authHeaderFor(url: string): Promise<Record<string, string>> {
	if (!url.startsWith("/api/gameplay")) {
		return {};
	}
	const token = await mintToken("gameplay").catch(() => null);
	return token ? { Authorization: `Bearer ${token.code}` } : {};
}

async function request<T = unknown>(
	method: string,
	path: string,
	body?: unknown,
	options?: { raw?: boolean },
): Promise<T> {
	const url = path.startsWith("/api") ? path : `${BASE}${path}`;

	const headers: Record<string, string> = await authHeaderFor(url);
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const res = await fetch(url, {
		method,
		credentials: "same-origin",
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});

	if (options?.raw) {
		return res as unknown as T;
	}

	if (!res.ok) {
		const text = await res.text();
		let message: string;
		try {
			message = JSON.parse(text).message ?? text;
		} catch {
			message = text;
		}
		throw new ApiError(message || `Request failed: ${res.status}`, res.status);
	}

	const contentType = res.headers.get("content-type");
	if (contentType?.includes("application/json")) {
		return res.json();
	}
	return res.text() as unknown as T;
}

export const api = {
	get: <T = unknown>(path: string) => request<T>("GET", path),
	post: <T = unknown>(path: string, body: unknown = {}) => request<T>("POST", path, body),
	put: <T = unknown>(path: string, body: unknown = {}) => request<T>("PUT", path, body),
	del: <T = unknown>(path: string) => request<T>("DELETE", path),
};
