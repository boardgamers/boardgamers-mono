import type { HandleFetch } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";
import { handleFetch, requestContextStorage } from "./hooks.server";

type Captured = { url: string; headers: Headers };

// jsdom's AbortSignal doesn't satisfy node's Request constructor, so pass a
// signal-less stub — handleFetch only reads request.url and request.headers.
function makeRequest(url: string, headers: Record<string, string> = {}) {
	return { url, headers: new Headers(headers) } as Request;
}

/** Minimal event stub — handleFetch only reads event.url + event.request's cookie header. */
function makeEvent(origin: string, headers: Record<string, string> = {}) {
	return {
		url: new URL(`${origin}/account`),
		request: makeRequest(`${origin}/account`, headers),
	};
}

function makeFetch(captured: Captured[], body = "{}") {
	const fetch: typeof globalThis.fetch = (input) => {
		const request = input as Request;
		captured.push({ url: request.url, headers: request.headers });
		return Promise.resolve(new Response(body));
	};
	return fetch;
}

const call = async (opts: {
	origin?: string;
	path?: string;
	body?: string;
	/**
	 * Headers the client (browser) sent on its inbound request to the web app. These land
	 * on BOTH event.request (inbound) and the outgoing request event.fetch builds — which
	 * is exactly how SvelteKit behaves (event.fetch copies the inbound headers), so this is
	 * where spoofed forwarding headers / spoofable client headers go.
	 */
	clientHeaders?: Record<string, string>;
	/**
	 * Headers present ONLY on the inbound event.request, not on the outgoing request.
	 * Use for the session cookie: the browser sends it to the web app, and the proxy is
	 * responsible for deciding (main-api only) whether to forward it — event.fetch does
	 * NOT auto-copy it once we rewrite the host.
	 */
	eventHeaders?: Record<string, string>;
	/** Simulate the `handle` hook having populated the AsyncLocalStorage context. */
	ctx?: { requestId: string; clientIp: string | undefined };
}) => {
	const origin = opts.origin ?? "https://boardgamers.space";
	const captured: Captured[] = [];
	const run = () =>
		handleFetch({
			request: makeRequest(`${origin}${opts.path ?? "/api/account"}`, opts.clientHeaders),
			fetch: makeFetch(captured, opts.body),
			event: makeEvent(origin, { ...opts.clientHeaders, ...opts.eventHeaders }),
		} as unknown as Parameters<HandleFetch>[0]);
	// handleFetch reads the request context from AsyncLocalStorage (set by `handle`
	// in production); wrap the call to simulate that when a ctx is provided.
	const response = opts.ctx ? await requestContextStorage.run(opts.ctx, run) : await run();
	return { response, captured };
};

describe("handleFetch (SSR /api proxy)", () => {
	it("sets X-Forwarded-Proto from the browser-facing protocol (https)", async () => {
		const { captured } = await call({ origin: "https://boardgamers.space" });
		expect(captured).toHaveLength(1);
		expect(captured[0].headers.get("x-forwarded-proto")).toBe("https");
	});

	it("sets X-Forwarded-Proto: http in local dev (no TLS, no Secure cookie requirement)", async () => {
		const { captured } = await call({ origin: "http://127.0.0.1:8612" });
		expect(captured[0].headers.get("x-forwarded-proto")).toBe("http");
	});

	it("applies to the gameplay backend too", async () => {
		const { captured } = await call({ path: "/api/gameplay/123" });
		expect(captured).toHaveLength(1);
		expect(captured[0].headers.get("x-forwarded-proto")).toBe("https");
	});

	it("does not touch non-api requests", async () => {
		const { captured } = await call({ path: "/favicon.png" });
		expect(captured).toHaveLength(1);
		expect(captured[0].headers.get("x-forwarded-proto")).toBeNull();
	});

	it("overwrites a client-spoofed X-Forwarded-Proto (authoritative origin wins)", async () => {
		// A client can send any x-forwarded-proto it likes; the proxy must not let that
		// spoof through to the api — the browser-facing origin (https here) wins.
		const { captured } = await call({ clientHeaders: { "x-forwarded-proto": "http" } });
		expect(captured[0].headers.get("x-forwarded-proto")).toBe("https");
	});

	it("overwrites a client-spoofed X-Forwarded-For — ctx.clientIp is the only value", async () => {
		// The api (app.proxy = true) reads the LEFTMOST x-forwarded-for as ctx.ip. The proxy
		// must overwrite, not append, so a client-supplied value can't occupy that slot and
		// spoof the client IP.
		const { captured } = await call({
			clientHeaders: { "x-forwarded-for": "6.6.6.6" }, // spoofed
			ctx: { requestId: "req-1", clientIp: "203.0.113.9" },
		});
		expect(captured[0].headers.get("x-forwarded-for")).toBe("203.0.113.9");
	});

	it("does not write an x-forwarded-for when ctx.clientIp is absent", async () => {
		// The `if (ctx.clientIp)` guard must skip the header entirely — never write an
		// empty/undefined XFF — even if the client tried to supply one.
		const { captured } = await call({
			clientHeaders: { "x-forwarded-for": "6.6.6.6" }, // spoofed
			ctx: { requestId: "req-1", clientIp: undefined },
		});
		expect(captured[0].headers.get("x-forwarded-for")).toBeNull();
	});

	it("strips client-supplied forwarding/tracking headers on the outbound request", async () => {
		const { captured } = await call({
			clientHeaders: {
				"x-forwarded-for": "6.6.6.6", // spoofed — re-added authoritatively below
				"x-forwarded-host": "evil.example.com",
				"x-real-ip": "6.6.6.6",
				"x-forwarded-server": "evil.example.com",
				"cf-connecting-ip": "6.6.6.6", // a cf-* header
				"cf-ipcountry": "XX",
			},
			ctx: { requestId: "req-1", clientIp: "203.0.113.9" },
		});
		const headers = captured[0].headers;
		// x-forwarded-for is stripped then re-stamped with the trusted clientIp.
		expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
		expect(headers.get("x-forwarded-host")).toBeNull();
		expect(headers.get("x-real-ip")).toBeNull();
		expect(headers.get("x-forwarded-server")).toBeNull();
		expect(headers.get("cf-connecting-ip")).toBeNull();
		expect(headers.get("cf-ipcountry")).toBeNull();
	});

	it("preserves legit headers and forwards the cookie to the main api", async () => {
		const { captured } = await call({
			clientHeaders: {
				authorization: "Bearer abc",
				"content-type": "application/json",
				accept: "application/json",
			},
			eventHeaders: { cookie: "refreshToken=tok123" },
			ctx: { requestId: "req-1", clientIp: "203.0.113.9" },
		});
		const headers = captured[0].headers;
		expect(headers.get("authorization")).toBe("Bearer abc");
		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.get("accept")).toBe("application/json");
		expect(headers.get("cookie")).toBe("refreshToken=tok123");
	});

	it("never forwards the session cookie to the gameplay backend", async () => {
		const { captured } = await call({
			path: "/api/gameplay/123",
			eventHeaders: { cookie: "refreshToken=tok123" },
			ctx: { requestId: "req-1", clientIp: "203.0.113.9" },
		});
		expect(captured[0].headers.get("cookie")).toBeNull();
	});

	it("stamps the request id from the context (overwriting any client value)", async () => {
		const { captured } = await call({
			clientHeaders: { "x-request-id": "client-supplied" },
			ctx: { requestId: "req-from-handle", clientIp: "203.0.113.9" },
		});
		expect(captured[0].headers.get("x-request-id")).toBe("req-from-handle");
	});
});
