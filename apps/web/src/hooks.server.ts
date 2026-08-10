import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Handle, HandleFetch } from "@sveltejs/kit";
import { logEvent } from "@bgs/utils/log";
import { extractCookie } from "@/utils/extract-cookie";

interface RequestContext {
	requestId: string;
	clientIp: string | undefined;
}

// Exported for tests (hooks.server.spec.ts) so the ctx-dependent header logic
// (x-request-id, x-forwarded-for) can be exercised without spinning up `handle`.
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const handle: Handle = async ({ event, resolve }) => {
	const clientIp = event.getClientAddress();
	const requestId = event.request.headers.get("x-request-id") || randomUUID();

	// Populate locals from cookies + request — this replaces the old getSession hook.
	const refreshToken = extractCookie("refreshToken", event.request.headers.get("cookie") ?? "") ?? null;
	const sidebarOpen = extractCookie("sidebarOpen", event.request.headers.get("cookie") ?? "");

	event.locals.ip = clientIp;
	event.locals.host = event.url.host;
	event.locals.refreshToken = refreshToken;
	event.locals.sidebarOpen = sidebarOpen;

	return requestContextStorage.run({ requestId, clientIp }, async () => {
		const start = Date.now();
		const path = event.url.pathname;

		let response;
		try {
			response = await resolve(event, {
				filterSerializedResponseHeaders: (name) => name === "content-type",
			});
		} catch (err) {
			logEvent("error", "ssr", {
				source: "web",
				method: event.request.method,
				path,
				requestId,
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack?.split("\n") : undefined,
			});
			throw err;
		}

		const durationMs = Date.now() - start;
		const status = response.status;
		logEvent(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", {
			source: "web",
			method: event.request.method,
			path,
			status,
			durationMs,
			requestId,
		});

		response.headers.set("x-request-id", requestId);
		return response;
	});
};

function backendUrl(override: string | undefined, defaultPort: number): string {
	const raw = (override ?? import.meta.env.VITE_backend ?? "127.0.0.1").replace(/^https?:\/\//, "");
	// Bare IPv6 (contains multiple colons, no brackets) has no port — a naive split(":")
	// would shred it. Otherwise split host:port on the last colon only.
	const isBareIpv6 = !raw.startsWith("[") && (raw.match(/:/g)?.length ?? 0) > 1;
	// A bracketed IPv6 literal keeps its brackets; only a "]:" suffix is a port.
	const idx = isBareIpv6
		? -1
		: raw.startsWith("[")
			? raw.indexOf("]:") === -1
				? -1
				: raw.indexOf("]:") + 1
			: raw.lastIndexOf(":");
	const host = idx === -1 ? raw : raw.slice(0, idx);
	const port = idx === -1 ? undefined : raw.slice(idx + 1);
	const ip = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	// Port 443 means TLS — lets SSR fetch a preview/prod API over https.
	const proto = (port ?? String(defaultPort)) === "443" ? "https" : "http";
	return `${proto}://${ip}:${port ?? defaultPort}`;
}

// Forwarding/tracking headers that must never travel from the client to the api on the
// SSR proxy hop — each is either re-added authoritatively below (x-forwarded-for) or
// simply untrusted. Headers are matched case-insensitively (Headers normalizes keys to
// lowercase). x-forwarded-for is stripped too: without it, a client-supplied XFF would
// pass through verbatim whenever ctx.clientIp is unavailable, re-opening the spoof.
const STRIPPED_FORWARDING_HEADERS = new Set(["x-forwarded-for", "x-forwarded-host", "x-real-ip", "x-forwarded-server"]);

/**
 * During SSR, event.fetch calls are routed through here. We rewrite /api/*
 * URLs to the backend host (same logic as the old externalFetch hook, minus the
 * null-body-status workaround which is no longer needed in modern SvelteKit).
 */
export const handleFetch: HandleFetch = async ({ request, fetch, event }) => {
	const ctx = requestContextStorage.getStore();
	const path = new URL(request.url).pathname;

	const isGameplay = path.startsWith("/api/gameplay");
	const isMainApi = !isGameplay && path.startsWith("/api/");

	// Backend address: `VITE_backend` (host or host:port — same var as vite.config.ts)
	// locates the api service; the gameplay backend defaults to the same host on its
	// standard port so multi-instance dev (one loopback IP per instance, default ports
	// — see AGENTS.md "Running instances") only has to set the one variable.
	// Per-service escape hatches: VITE_backend_api / VITE_backend_gameplay.
	const backend = isGameplay
		? backendUrl(import.meta.env.VITE_backend_gameplay, 50803)
		: isMainApi
			? backendUrl(import.meta.env.VITE_backend_api, 50801)
			: null;

	if (backend) {
		request = new Request(request.url.replace(event.url.origin, backend), request);

		// Forward the session cookie to the main API only (never the game-server). SvelteKit's
		// event.fetch only auto-forwards cookies when the target host matches the app origin —
		// but we rewrite /api/* to the backend host, so forward it explicitly. The game-server
		// runs untrusted engine code and must only ever see the minted "gameplay"-scoped bearer
		// token, never the full-power session cookie. Request-scoped, never shared state.
		const cookie = event.request.headers.get("cookie");
		if (isMainApi && cookie && !request.headers.has("cookie")) {
			request.headers.set("cookie", cookie);
		}

		// new Request(url, request) copies every client header, so drop the forwarding /
		// tracking headers a client can spoof before re-adding the only ones the api should
		// trust below. Otherwise an attacker-controlled x-real-ip / x-forwarded-host / cf-*
		// would reach the api verbatim. (The wildcard cf-* covers Cloudflare's ip/prefetch/
		// scheme/etc. headers — none are set by our own proxy, so any inbound one is forged.)
		for (const name of [...request.headers.keys()]) {
			if (STRIPPED_FORWARDING_HEADERS.has(name) || name.startsWith("cf-")) {
				request.headers.delete(name);
			}
		}

		if (ctx) {
			request.headers.set("x-request-id", ctx.requestId);
			if (ctx.clientIp) {
				// Overwrite — never append. The api (app.proxy = true) reads the LEFTMOST
				// x-forwarded-for as ctx.ip, so appending would leave a client-supplied value
				// in that slot and let a client spoof its IP (poisoning security.lastIp,
				// lastLogin.ip and log/error attribution). ctx.clientIp is the trusted value
				// we stamp authoritatively: in prod it's the real client IP resolved from
				// nginx's XFF (ADDRESS_HEADER/XFF_DEPTH are set in ecosystem.config.cjs), and
				// in dev/preview (no nginx) it's the direct peer — either way the overwrite,
				// not the env, is what strips the spoof off the wire.
				request.headers.set("x-forwarded-for", ctx.clientIp);
			}
		}

		// Tell the api the protocol of the browser→web hop (https in prod). The SSR hop
		// itself is plain http on loopback, so without this the api (app.proxy = true)
		// computes ctx.secure === false and its sliding-session middleware throws
		// "Cannot send secure cookie over unencrypted connection" (secure-cookie-over-insecure).
		// Use event.url.protocol — the browser-facing origin (https under adapter-node's
		// prod default, http in vite dev) — and overwrite rather than append so a
		// client-supplied spoof can't win. (adapter-node doesn't read nginx's
		// x-forwarded-proto — PROTOCOL_HEADER is unset in prod so it defaults to https.)
		request.headers.set("x-forwarded-proto", event.url.protocol.replace(/:$/, ""));
	}

	const response = await fetch(request);
	if (!response.ok) {
		logEvent(response.status >= 500 ? "error" : "warn", "upstream", {
			source: "web",
			path,
			status: response.status,
			requestId: ctx?.requestId,
		});
	}
	return response;
};
