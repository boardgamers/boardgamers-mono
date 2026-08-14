import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { api } from "./api.ts";

describe("api.post", () => {
	let calls: { url: string; init: RequestInit }[] = [];
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		calls = [];
		originalFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			return new Response("{}", {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("sends a JSON body and content-type even without a body argument", async () => {
		await api.post("/admin/games/x/cancel");

		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, "/api/admin/games/x/cancel");
		assert.equal(calls[0].init.method, "POST");
		assert.equal(calls[0].init.body, "{}");
		assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json" });
	});

	it("still sends the caller's body when one is provided", async () => {
		await api.post("/admin/games/x/cancel", { reason: "cleanup" });

		assert.equal(calls[0].init.body, JSON.stringify({ reason: "cleanup" }));
	});
});
