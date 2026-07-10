import { tokens, clearTokens } from "./auth.svelte.ts";

const BASE = "/api";

export class ApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

async function getAccessToken(url: string): Promise<string | null> {
	const scopes = url.startsWith("/api/gameplay") ? ["gameplay"] : ["all"];
	const key = scopes.join(",");

	const existing = tokens.getAccess(key);
	if (existing && existing.expiresAt > Date.now() + 5 * 60 * 1000) {
		return existing.code;
	}

	const refresh = tokens.refresh;
	if (!refresh) {
		return null;
	}

	try {
		const res = await fetch(`${BASE}/account/refresh`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: refresh.code, scopes }),
		});

		if (res.status === 404) {
			clearTokens();
			return null;
		}

		if (!res.ok) {
			return null;
		}

		const data = await res.json();
		tokens.setAccess(key, data);
		return data.code;
	} catch {
		return null;
	}
}

async function request<T = unknown>(
	method: string,
	path: string,
	body?: unknown,
	options?: { raw?: boolean },
): Promise<T> {
	const url = path.startsWith("/api") ? path : `${BASE}${path}`;
	const token = await getAccessToken(url);

	const headers: Record<string, string> = {};
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
	}
	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	const res = await fetch(url, {
		method,
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
	post: <T = unknown>(path: string, body?: unknown) => request<T>("POST", path, body),
	put: <T = unknown>(path: string, body?: unknown) => request<T>("PUT", path, body),
	del: <T = unknown>(path: string) => request<T>("DELETE", path),
};
