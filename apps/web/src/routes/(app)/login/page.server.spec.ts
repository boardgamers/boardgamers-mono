import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Seeds the request event that api.ts's requestFetch() resolves via getRequestEvent()
// — without it the load's apiFetch uses the global fetch instead of event.fetch.
// @ts-expect-error -- internal subpath (its .d.ts is the kit types index, not a module); respond.js uses it at runtime.
import { with_request_store } from "@sveltejs/kit/internal/server";
import { stubFetch } from "../../../../vitest.setup";
import { load } from "./+page.server";

type Event = Parameters<typeof load>[0];

const HANDOFF = JSON.stringify({ code: "handoff-code", expiresAt: Date.now() + 1e6 });

const fetchMock = vi.fn();

function makeEvent(search: string): { event: Event; cookies: { name: string; value: string }[] } {
	const url = new URL(`http://localhost:8612/login${search}`);
	const cookies: { name: string; value: string }[] = [];
	// SvelteKit's event.fetch resolves relative URLs against the page origin — the
	// mock must do the same (a bare vi.fn() would get "/api/account/session" and
	// apiFetch's .catch(() => null) would swallow the resulting URL parse error).
	const eventFetch = vi.fn((input: string | URL | Request, init?: RequestInit) =>
		fetchMock(new URL(String(input), url).href, init),
	);
	const event = {
		url,
		request: new Request(url),
		fetch: eventFetch,
		cookies: {
			set: (name: string, value: string) => cookies.push({ name, value }),
		},
		parent: vi.fn().mockResolvedValue({ user: null }),
	} as unknown as Event;
	return { event, cookies };
}

/** load() always ends in a thrown redirect; unwrap it. */
async function redirectOf(event: Event): Promise<{ status: number; location: string }> {
	try {
		await with_request_store({ event, state: {} }, () => load(event));
	} catch (err) {
		const redirect = err as { status?: number; location?: string };
		if (typeof redirect.status === "number" && typeof redirect.location === "string") {
			return { status: redirect.status, location: redirect.location };
		}
		throw err;
	}
	throw new Error("load resolved without redirecting");
}

beforeEach(() => {
	// The load's apiFetch resolves globalThis.fetch in this env (see vitest.setup.ts).
	stubFetch(fetchMock);
});

afterEach(() => {
	stubFetch(null);
	fetchMock.mockReset();
});

describe("login page server load — ?refreshToken= handoff", () => {
	it("exchanges the code, relays the session cookie, strips the code, keeps ?redirect=", async () => {
		const upstream = new Response(JSON.stringify({ user: {} }), { status: 200 });
		upstream.headers.append("set-cookie", "refreshToken=fresh; Path=/; HttpOnly; SameSite=Lax");
		fetchMock.mockResolvedValue(upstream);

		const { event, cookies } = makeEvent(`?refreshToken=${encodeURIComponent(HANDOFF)}&redirect=%2Fgames`);
		const { status, location } = await redirectOf(event);

		// The code went to the exchange endpoint, once.
		expect(fetchMock).toHaveBeenCalledOnce();
		const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(target).toContain("/api/account/session");
		expect(JSON.parse(String(init.body))).toEqual({ code: "handoff-code" });

		// The fresh session cookie is relayed to the browser…
		expect(cookies.some((c) => c.name === "refreshToken" && c.value === "fresh")).toBe(true);
		// …and the browser lands on the redirect target, the one-time code gone from the URL.
		expect(status).toBe(303);
		expect(location).toBe("/games");
	});

	it("a rejected exchange bounces to /login with an error, the dead code dropped", async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

		const { event, cookies } = makeEvent(`?refreshToken=${encodeURIComponent(HANDOFF)}&redirect=%2Fgames`);
		const { status, location } = await redirectOf(event);

		expect(status).toBe(303);
		const target = new URL(location, "http://localhost:8612");
		expect(target.pathname).toBe("/login");
		expect(target.searchParams.has("refreshToken")).toBe(false);
		expect(target.searchParams.get("error")).toBeTruthy();
		expect(target.searchParams.get("redirect")).toBe("/games");
		expect(cookies).toEqual([]);
	});

	it("a malformed handoff value never reaches the api", async () => {
		const { event } = makeEvent("?refreshToken=garbage");
		const { location } = await redirectOf(event);

		expect(fetchMock).not.toHaveBeenCalled();
		const target = new URL(location, "http://localhost:8612");
		expect(target.pathname).toBe("/login");
		expect(target.searchParams.has("refreshToken")).toBe(false);
		expect(target.searchParams.get("error")).toBeTruthy();
	});
});
