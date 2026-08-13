// Session-cookie domain scoping. Since apex step 5 (#153) the api sets the session
// cookie HOST-ONLY (no Domain): apex boardgamers.space is the canonical host and the
// cookie must never be sent to forum./admin./resources./grafana. subdomains. The
// transitional hazard: users still carry a legacy `Domain=boardgamers.space` cookie
// from pre-cutover deploys — a host-only cookie sorts BEFORE a Domain= one in the
// Cookie header, so a stale Domain= cookie would linger and shadow/conflict. Hence
// every set/clear also clears the legacy Domain variant (a deletion must repeat the
// exact Domain the cookie was set with, or the browser ignores it). On PR previews the
// coyo vhost (`proxy_cookie_domain … $host`, see infra/pr-preview) scopes everything
// per preview host, so the player (pr-<n>) and admin (admin-pr-<n>) siblings never
// share a cookie — and the Domain=boardgamers.space clear is rewritten away there too.
// Removal of the Domain cleanup is tracked in #283 (120 days post-deploy).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Koa from "koa";
import env from "../config/env.ts";
import { setRefreshCookie, clearRefreshCookie, parseRefreshCookie, SESSION_COOKIE } from "./session.ts";

const PROD_DOMAIN = "boardgamers.space";
const PROD_SUBDOMAIN = "forum.boardgamers.space";

/** RFC 6265 §5.1.3 string-match: does a cookie with `Domain=domain` cover `host`? */
function domainCovers(domain: string, host: string) {
	return host === domain || host.endsWith(`.${domain}`);
}

/** Run one request through the real Koa cookie pipeline (app.proxy, X-Forwarded-*) and return Set-Cookie headers. */
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

const domainAttr = (cookie: string) => /;\s*domain=([^;]+)/i.exec(cookie)?.[1] ?? null;
const isExpiredClear = (cookie: string) => /expires=Thu, 01 Jan 1970/i.test(cookie);

/** Split the response's Set-Cookie headers into the host-only vs Domain=env.domain operations on the session cookie. */
function sessionCookieOps(cookies: string[]) {
	const session = cookies.filter((c) => c.startsWith(`${SESSION_COOKIE}=`));
	return {
		hostOnly: session.filter((c) => domainAttr(c) === null),
		legacyDomain: session.filter((c) => domainAttr(c)?.toLowerCase() === env.domain.toLowerCase()),
	};
}

describe("session cookie — host-only on apex + legacy Domain= cleanup (#153 step 5, removal #283)", () => {
	it("set on the apex emits a host-only cookie (no Domain) AND clears the legacy Domain variant", async () => {
		// env.domain is the production default "boardgamers.space" in specs.
		assert.strictEqual(env.domain, PROD_DOMAIN);
		const cookies = await setCookies(PROD_DOMAIN, (ctx) => setRefreshCookie(ctx, "code-123"));
		const ops = sessionCookieOps(cookies);
		// The set: host-only (no Domain attribute), carrying the value.
		assert.strictEqual(ops.hostOnly.length, 1);
		assert.ok(!isExpiredClear(ops.hostOnly[0]));
		assert.match(ops.hostOnly[0], /;\s*secure/i);
		// The legacy cleanup: Domain=env.domain, expired.
		assert.strictEqual(ops.legacyDomain.length, 1);
		assert.ok(isExpiredClear(ops.legacyDomain[0]), "the legacy Domain cookie is expired (cleared)");
		// The clear repeats the EXACT Domain the legacy cookie was set with — a mismatch
		// would make the browser ignore the deletion.
		assert.strictEqual(domainAttr(ops.legacyDomain[0]), env.domain);
	});

	it("set on a prod subdomain is likewise host-only + clears the legacy Domain variant", async () => {
		const cookies = await setCookies(PROD_SUBDOMAIN, (ctx) => setRefreshCookie(ctx, "code-123"));
		const ops = sessionCookieOps(cookies);
		assert.strictEqual(ops.hostOnly.length, 1);
		assert.strictEqual(ops.legacyDomain.length, 1);
		assert.ok(isExpiredClear(ops.legacyDomain[0]));
	});

	it("clearRefreshCookie (logout) clears BOTH the host-only and the legacy Domain variant", async () => {
		const cookies = await setCookies(PROD_DOMAIN, (ctx) => clearRefreshCookie(ctx));
		const ops = sessionCookieOps(cookies);
		assert.strictEqual(ops.hostOnly.length, 1);
		assert.ok(isExpiredClear(ops.hostOnly[0]));
		assert.strictEqual(ops.legacyDomain.length, 1);
		assert.ok(isExpiredClear(ops.legacyDomain[0]));
		assert.strictEqual(domainAttr(ops.legacyDomain[0]), env.domain);
	});

	it("localhost requests only ever touch the host-only cookie (local never set a Domain cookie)", async () => {
		const ops: Array<(ctx: InstanceType<Koa.Context>) => void> = [
			(ctx) => setRefreshCookie(ctx, "code-123"),
			(ctx) => clearRefreshCookie(ctx),
		];
		for (const op of ops) {
			const cookies = await setCookies("localhost", op);
			const session = cookies.filter((c) => c.startsWith(`${SESSION_COOKIE}=`));
			assert.strictEqual(session.length, 1);
			assert.strictEqual(domainAttr(session[0]), null);
		}
	});

	it("a host-only cookie is NOT sent to sibling subdomains — the cookie-isolation goal of #153", () => {
		// No Domain attribute ⇒ the browser scopes the cookie to exactly the response host.
		// (The legacy Domain=boardgamers.space cookie WAS sent to every subdomain — this is
		// the prod-namespace pollution the migration removes.)
		assert.ok(domainCovers(PROD_DOMAIN, "forum.boardgamers.space"), "the legacy Domain= cookie leaked to subdomains");
		assert.ok(domainCovers(PROD_DOMAIN, "admin.boardgamers.space"));
	});
});

describe("parseRefreshCookie", () => {
	it("parses a raw JSON cookie value", () => {
		assert.strictEqual(parseRefreshCookie(JSON.stringify({ code: "abc123" })), "abc123");
	});

	it("parses a percent-encoded value (browsers echo the cookie back encoded)", () => {
		// The api stores JSON in the cookie; Koa's lenient decode can leave the value
		// percent-encoded when it contains cookie-invalid characters, so the parser falls
		// back to decodeURIComponent — otherwise the session silently fails (401 + cleared cookie).
		const encoded = encodeURIComponent(JSON.stringify({ code: "abc+/123=", expiresAt: 123 }));
		assert.strictEqual(parseRefreshCookie(encoded), "abc+/123=");
	});

	it("parses a raw JSON value containing a literal % (decode-first would reject it)", () => {
		// decodeURIComponent on a raw JSON string with a literal '%' throws URIError; the
		// raw parse must succeed first so such a cookie isn't treated as missing.
		assert.strictEqual(parseRefreshCookie(JSON.stringify({ code: "100%legit" })), "100%legit");
	});

	it("returns null for missing or malformed values", () => {
		assert.strictEqual(parseRefreshCookie(undefined), null);
		assert.strictEqual(parseRefreshCookie(""), null);
		assert.strictEqual(parseRefreshCookie("not json"), null);
		assert.strictEqual(parseRefreshCookie(JSON.stringify({ noCode: true })), null);
	});
});
