// Session-cookie domain scoping (RFC 6265 §5.1.3: the browser stores a `Domain` cookie
// only when the request host equals it or is a subdomain of it, then sends it to that
// domain and all of ITS subdomains). Regression guard for the preview login bug: on PR
// previews the player app (pr-<n>.boardgamers.space) and the admin panel
// (admin-pr-<n>.boardgamers.space) are SIBLING hosts — a `Domain=pr-<n>.boardgamers.space`
// cookie is rejected on the admin host. The api therefore takes the cookie domain from
// `cookieDomain` (boardgamers.space on previews — the only shared ancestor below the eTLD),
// falling back to `domain` (prod: cookieDomain is unset → domain=boardgamers.space).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Koa from "koa";
import env from "../config/env.ts";
import { setRefreshCookie, clearRefreshCookie, SESSION_COOKIE } from "./session.ts";

const PREVIEW_PR = "pr-165.boardgamers.space";
const PREVIEW_ADMIN = "admin-pr-165.boardgamers.space";

/** RFC 6265 §5.1.3 string-match, i.e. whether `host` is covered by a cookie with `Domain=domain`. */
function domainMatches(host: string, domain: string) {
	return (
		host === domain ||
		(host.endsWith(`.${domain}`) && !host.endsWith(".")) /* host is a name, not an IP for these hosts */
	);
}

/** Emit the Set-Cookie header(s) setRefreshCookie/clearRefreshCookie produce for a forwarded request. */
async function setCookies(host: string, set: (ctx: InstanceType<Koa.Context>) => void): Promise<string[]> {
	const app = new Koa();
	app.proxy = true; // as apps/api/app/app.ts — hostname/proto come from X-Forwarded-*
	app.keys = ["test-secret"];
	app.use((ctx) => {
		set(ctx);
		ctx.body = "ok";
	});
	const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
		const s = app.listen(0, "127.0.0.1", () => resolve(s));
	});
	const addr = server.address();
	const port = typeof addr === "object" && addr ? addr.port : 0;
	try {
		const res = await fetch(`http://127.0.0.1:${port}/`, {
			headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" },
		});
		assert.strictEqual(res.status, 200);
		return res.headers.getSetCookie();
	} finally {
		server.close();
	}
}

const cookieNamed = (cookies: string[], name: string) => {
	const cookie = cookies.find((c) => c.startsWith(`${name}=`));
	assert.ok(cookie, `expected a Set-Cookie for ${name}`);
	return cookie;
};

describe("session cookie — Domain attribute", () => {
	it("uses env.cookieDomain (default: env.domain), accepted by both sibling preview hosts", async () => {
		// The spec runs with the api's default env (no `domain`/`cookieDomain` in .env.test),
		// so cookieDomain === domain === "boardgamers.space" — the value the preview manager
		// now passes explicitly. The assertion below is about the sibling-host invariant.
		assert.strictEqual(env.cookieDomain, "boardgamers.space");
		const cookies = await setCookies(PREVIEW_ADMIN, (ctx) => setRefreshCookie(ctx, "code-123"));
		const cookie = cookieNamed(cookies, SESSION_COOKIE);
		const domain = /;\s*domain=([^;]+)/i.exec(cookie)?.[1];
		assert.strictEqual(domain?.toLowerCase(), env.cookieDomain.toLowerCase());
		// The invariant the preview fix relies on: the Domain value covers BOTH the admin
		// host the response was emitted on AND the sibling player host (and prod hosts).
		assert.ok(domainMatches(PREVIEW_ADMIN, env.cookieDomain));
		assert.ok(domainMatches(PREVIEW_PR, env.cookieDomain));
		assert.ok(domainMatches("admin.boardgamers.space", env.cookieDomain));
		assert.ok(domainMatches("www.boardgamers.space", env.cookieDomain));
	});

	it("clearRefreshCookie repeats the same Domain (a mismatched Domain would not clear it)", async () => {
		const cookies = await setCookies(PREVIEW_ADMIN, (ctx) => clearRefreshCookie(ctx));
		assert.match(
			cookieNamed(cookies, SESSION_COOKIE),
			new RegExp(`;\\s*domain=${env.cookieDomain.replaceAll(".", "\\.")}`, "i"),
		);
	});

	it("localhost requests get a host-only cookie (no Domain attribute)", async () => {
		const cookies = await setCookies("localhost", (ctx) => setRefreshCookie(ctx, "code-123"));
		assert.doesNotMatch(cookieNamed(cookies, SESSION_COOKIE), /;\s*domain=/i);
	});

	it("documenting the bug: the per-env domain does NOT cover the sibling admin host", () => {
		// Why domain=pr-<n>.boardgamers.space can't be the cookie domain: the admin host is
		// a sibling, not a subdomain. The browser rejects Domain=pr-165.boardgamers.space on
		// admin-pr-165.boardgamers.space — this is the rejection from the reported screenshot.
		assert.ok(!domainMatches(PREVIEW_ADMIN, PREVIEW_PR));
		assert.ok(domainMatches(PREVIEW_PR, PREVIEW_PR));
	});
});
