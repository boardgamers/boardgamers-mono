import type { HandleFetch } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";
import { handleFetch } from "./hooks.server";

type Captured = { url: string; headers: Headers };

// jsdom's AbortSignal doesn't satisfy node's Request constructor, so pass a
// signal-less stub — handleFetch only reads request.url and request.headers.
function makeRequest(url: string) {
	return { url, headers: new Headers() } as Request;
}

/** Minimal event stub — handleFetch only reads event.url + event.request's cookie header. */
function makeEvent(origin: string) {
	return {
		url: new URL(`${origin}/account`),
		request: makeRequest(`${origin}/account`),
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

const call = async (opts: { origin?: string; path?: string; body?: string }) => {
	const origin = opts.origin ?? "https://boardgamers.space";
	const captured: Captured[] = [];
	const response = await handleFetch({
		request: makeRequest(`${origin}${opts.path ?? "/api/account"}`),
		fetch: makeFetch(captured, opts.body),
		event: makeEvent(origin),
	} as unknown as Parameters<HandleFetch>[0]);
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
});
