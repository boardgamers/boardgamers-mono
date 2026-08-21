import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Handle, HandleFetch } from "@sveltejs/kit";
import { logEvent } from "@bgs/utils/log";
import { backendUrl } from "@/lib/backend-url.server";
import { parsePreferredLanguage } from "@/lib/accept-language";
import { logHeader } from "@/lib/log-header";
import { extractCookie } from "@/utils/extract-cookie";
import { timezoneFromCookieHeader } from "@/lib/timezone";
import { resolveLanguage } from "@/lib/i18n/language";
import { languageStorage } from "@/lib/i18n/server";

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
	// Viewer's timezone, stamped into a cookie by the client (see src/lib/timezone).
	// Seeds SSR time-of-day rendering so it matches client hydration (#339).
	event.locals.timezone = timezoneFromCookieHeader(event.request.headers.get("cookie") ?? "") ?? "UTC";
	// Viewer's UI language (#306): `lang` cookie → Accept-Language → "en" (see
	// src/lib/i18n/language.ts). The logged-in user's settings.language layer is
	// applied on top of this in the root layout server load — hooks don't have
	// the user yet. The paraglide AsyncLocalStorage below makes message
	// functions render this request's locale during SSR.
	event.locals.language = resolveLanguage({
		cookieHeader: event.request.headers.get("cookie"),
		acceptLanguageHeader: event.request.headers.get("accept-language"),
	});

	return requestContextStorage.run({ requestId, clientIp }, async () => {
		const start = Date.now();
		const path = event.url.pathname;

		let response;
		try {
			response = await languageStorage.run({ locale: event.locals.language }, () =>
				resolve(event, {
					filterSerializedResponseHeaders: (name) => name === "content-type",
					// app.html ships `<html lang="en">` — rewrite it per request so the
					// first paint carries the resolved language (a11y/SEO). When the
					// layout overrides with the user preference, the client re-stamps
					// the cookie so subsequent SSR agrees (see +layout.ts).
					transformPageChunk: ({ html }) => html.replace('<html lang="en">', `<html lang="${event.locals.language}">`),
				}),
			);
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
		// The visitor's preferred language (Accept-Language) rides the request log
		// line to Loki — that's the i18n-prioritization data source (see
		// src/lib/accept-language.ts). Omitted when the header is absent/uncountable.
		const lang = parsePreferredLanguage(event.request.headers.get("accept-language"));
		// ua (User-Agent) + referer ride the same line — bot/scraper vs browser
		// traffic and where it comes from (see src/lib/log-header.ts). Bounded and
		// omitted when absent; the client IP is deliberately NOT logged here.
		const ua = logHeader(event.request.headers.get("user-agent"));
		const referer = logHeader(event.request.headers.get("referer"));
		logEvent(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", {
			source: "web",
			method: event.request.method,
			path,
			status,
			durationMs,
			requestId,
			...(lang ? { lang } : {}),
			...(ua ? { ua } : {}),
			...(referer ? { referer } : {}),
		});

		response.headers.set("x-request-id", requestId);
		return response;
	});
};

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
		// but we rewrite /api/* to the backend host, so forward it explicitly. Take it from
		// event.request unconditionally: the SSR load's own Request may carry no cookie header
		// at all (SvelteKit only auto-adds headers to header-less, same-origin requests — the
		// rewrite above already made this one cross-origin), so gating on
		// `!request.headers.has("cookie")` would leave the browser's session behind.
		// The game-server runs untrusted engine code and must only ever see the minted
		// "gameplay"-scoped bearer token, never the full-power session cookie.
		// Request-scoped, never shared state.
		const cookie = event.request.headers.get("cookie");
		if (isMainApi && cookie) {
			request.headers.set("cookie", cookie);
		}

		// Same story for Accept-Language (#306): the api negotiates content language
		// (CMS pages, game metadata) from it, but the origin rewrite drops the
		// browser's header on the floor. Forward the browser's value so SSR first
		// paint comes back in the negotiated language.
		const acceptLanguage = event.request.headers.get("accept-language");
		if (isMainApi && acceptLanguage) {
			request.headers.set("accept-language", acceptLanguage);
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
