import net from "node:net";
import type { HandleFetch } from "@sveltejs/kit";

function backendUrl(override: string | undefined, defaultPort: number): string {
	const raw = (override ?? import.meta.env.VITE_backend ?? "127.0.0.1").replace(/^https?:\/\//, "");
	// Bare IPv6 (contains multiple colons, no brackets) has no port — a naive split(":")
	// would shred it. Otherwise split host:port on the last colon only.
	const isBareIpv6 = !raw.startsWith("[") && (raw.match(/:/g)?.length ?? 0) > 1;
	const idx = raw.lastIndexOf(":");
	const host = isBareIpv6 || idx === -1 ? raw : raw.slice(0, idx);
	const port = isBareIpv6 || idx === -1 ? undefined : raw.slice(idx + 1);
	const ip = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
	return `http://${ip}:${port ?? defaultPort}`;
}

/**
 * During SSR, event.fetch calls are routed through here. We rewrite /api/*
 * URLs to the backend host — same logic as the web app (apps/web/src/hooks.server.ts).
 */
export const handleFetch: HandleFetch = async ({ request, fetch, event }) => {
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

		// Forward the session cookie to the main API only (never the game-server — it runs
		// untrusted engine code and must only see minted "gameplay"-scoped bearer tokens).
		// SvelteKit's event.fetch only auto-forwards cookies when the target host matches
		// the app origin — but we rewrite /api/* to the backend host, so forward explicitly.
		const cookie = event.request.headers.get("cookie");
		if (isMainApi && cookie && !request.headers.has("cookie")) {
			request.headers.set("cookie", cookie);
		}

		// The API reads ctx.hostname / ctx.protocol from X-Forwarded-Host / X-Forwarded-Proto
		// (app.proxy = true) to decide the session cookie's `secure` and `domain` attributes,
		// and cookies.set throws "Cannot send secure cookie over unencrypted connection" when
		// the proto says http but the cookie is secure. Forwarding the incoming values (a
		// proxying nginx sets them) keeps the API's view of the browser connection intact
		// end-to-end. In dev (direct requests, host = the dev server) we strip any spoofed
		// headers instead so the API sees the request as local — same as the web app.
		const isPublicHost = event.url.hostname !== "localhost" && !net.isIP(event.url.hostname);
		const fwdHost = event.request.headers.get("x-forwarded-host");
		const fwdProto = event.request.headers.get("x-forwarded-proto");
		if (isPublicHost && fwdHost && fwdProto) {
			request.headers.set("x-forwarded-host", fwdHost);
			request.headers.set("x-forwarded-proto", fwdProto);
		} else {
			request.headers.delete("x-forwarded-host");
			request.headers.delete("x-forwarded-proto");
		}
	}

	return fetch(request);
};
