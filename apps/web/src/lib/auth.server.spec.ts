import type { RequestEvent } from "@sveltejs/kit";
import { describe, expect, it } from "vitest";
import { forwardSessionCookies } from "./auth.server";

type SetCall = { name: string; value: string; opts: Record<string, unknown> };

function makeEvent(hostname: string, https = false) {
	const set: SetCall[] = [];
	const event = {
		url: new URL(`${https ? "https" : "http"}://${hostname}/login`),
		cookies: {
			set: (name: string, value: string, opts: Record<string, unknown>) => set.push({ name, value, opts }),
		},
	} as unknown as RequestEvent;
	return { event, set };
}

function makeResponse(setCookies: string[]): Response {
	return { headers: { getSetCookie: () => setCookies } } as unknown as Response;
}

describe("forwardSessionCookies", () => {
	it("relays a login cookie: value decoded, attrs forwarded, secure off over http", () => {
		const { event, set } = makeEvent("localhost");
		const encoded = encodeURIComponent('{"code":"abc","expiresAt":123}');
		forwardSessionCookies(
			event,
			makeResponse([
				`refreshToken=${encoded}; path=/; expires=Mon, 07 Dec 2026 16:09:41 GMT; samesite=strict; httponly`,
			]),
		);
		expect(set).toHaveLength(1);
		expect(set[0].name).toBe("refreshToken");
		// decoded before cookies.set (which re-encodes on write) — never double-encoded
		expect(set[0].value).toBe('{"code":"abc","expiresAt":123}');
		expect(set[0].opts).toMatchObject({
			path: "/",
			httpOnly: true,
			sameSite: "strict",
			secure: false, // plain http
		});
		expect(set[0].opts.expires).toBeInstanceOf(Date);
	});

	it("forces secure on over https", () => {
		const { event, set } = makeEvent("boardgamers.space", true);
		forwardSessionCookies(event, makeResponse(["refreshToken=x; path=/; httponly"]));
		expect(set[0].opts.secure).toBe(true);
	});

	it("forwards Domain when it covers the current host", () => {
		const { event, set } = makeEvent("www.boardgamers.space", true);
		forwardSessionCookies(event, makeResponse(["refreshToken=x; path=/; domain=boardgamers.space"]));
		expect(set[0].opts.domain).toBe("boardgamers.space");
	});

	it("drops Domain when it does NOT cover the current host (browser would reject it)", () => {
		// preview admin host, API cookie scoped to the sibling player host
		const { event, set } = makeEvent("admin-pr-188.boardgamers.space", true);
		forwardSessionCookies(event, makeResponse(["refreshToken=x; path=/; domain=pr-188.boardgamers.space"]));
		expect(set[0].opts.domain).toBeUndefined();
	});

	it("relays a logout clear (empty value + past expiry)", () => {
		const { event, set } = makeEvent("localhost");
		forwardSessionCookies(
			event,
			makeResponse(["refreshToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; httponly"]),
		);
		expect(set[0].value).toBe("");
		expect((set[0].opts.expires as Date).getTime()).toBeLessThanOrEqual(0);
	});

	it("skips malformed header entries without throwing", () => {
		const { event, set } = makeEvent("localhost");
		forwardSessionCookies(event, makeResponse(["no-equals-sign"]));
		expect(set).toHaveLength(0);
	});
});
