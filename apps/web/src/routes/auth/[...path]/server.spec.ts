import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./+server";

type Event = Parameters<typeof GET>[0];

function makeEvent(path = "google", search = ""): Event {
	const url = new URL(`https://boardgamers.space/auth/${path}${search}`);
	return {
		params: { path },
		url,
		// A client trying to smuggle forwarding headers — the proxy must not copy them.
		request: new Request(url, {
			headers: { cookie: "refreshToken=abc", "x-forwarded-for": "6.6.6.6", "x-real-ip": "6.6.6.6" },
		}),
		getClientAddress: () => "203.0.113.7",
	} as unknown as Event;
}

const fetchMock = vi.fn();

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
});

describe("/auth proxy", () => {
	it("proxies to the api with explicit forwarding headers only", async () => {
		fetchMock.mockResolvedValue(
			new Response(null, { status: 302, headers: { location: "https://accounts.google.com/o/oauth2/v2/auth?x" } }),
		);

		const response = await GET(makeEvent("google"));

		expect(fetchMock).toHaveBeenCalledOnce();
		const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Headers }];
		expect(target).toBe("http://127.0.0.1:50801/auth/google");
		expect(init.redirect).toBe("manual");
		expect(init.headers.get("cookie")).toBe("refreshToken=abc");
		expect(init.headers.get("x-forwarded-proto")).toBe("https");
		expect(init.headers.get("x-forwarded-host")).toBe("boardgamers.space");
		expect(init.headers.get("x-forwarded-for")).toBe("203.0.113.7");
		expect(init.headers.get("x-real-ip")).toBeNull();

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?x");
	});

	it("passes callback redirects through with Set-Cookie and the query string", async () => {
		const upstream = new Response(null, { status: 303, headers: { location: "https://boardgamers.space/account" } });
		upstream.headers.append("set-cookie", "refreshToken=new; Path=/; HttpOnly");
		upstream.headers.append("set-cookie", "sessionHint=1; Path=/");
		fetchMock.mockResolvedValue(upstream);

		const response = await GET(makeEvent("google/callback", "?code=abc&state=xyz"));

		const [target] = fetchMock.mock.calls[0] as [string];
		expect(target).toBe("http://127.0.0.1:50801/auth/google/callback?code=abc&state=xyz");
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("https://boardgamers.space/account");
		expect(response.headers.getSetCookie()).toEqual(["refreshToken=new; Path=/; HttpOnly", "sessionHint=1; Path=/"]);
	});

	it("turns api JSON errors into a friendly /login?error=… redirect", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ message: "github: access denied" }), {
				status: 403,
				headers: { "content-type": "application/json" },
			}),
		);

		const response = await GET(makeEvent("github/callback", "?error=access_denied"));

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(`/login?error=${encodeURIComponent("github: access denied")}`);
	});

	it("redirects to /login with a generic message when the api is unreachable", async () => {
		fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

		const response = await GET(makeEvent("google"));

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			`/login?error=${encodeURIComponent("Social login failed: could not reach the auth service (ECONNREFUSED)")}`,
		);
	});

	it("falls back to an explicit status-based message for non-JSON error bodies", async () => {
		fetchMock.mockResolvedValue(new Response("<html>nope</html>", { status: 404 }));

		const response = await GET(makeEvent("unknown-provider"));

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			`/login?error=${encodeURIComponent("Social login failed (HTTP 404)")}`,
		);
	});
});
