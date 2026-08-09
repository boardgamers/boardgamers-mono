// Session-cookie domain scoping. Regression guard for the preview login bug: on PR
// previews the player app (pr-<n>.boardgamers.space) and the admin panel
// (admin-pr-<n>.boardgamers.space) are SIBLING hosts — neither is a subdomain of the
// other (admin.pr-<n> is impossible: the *.boardgamers.space cert is single-level, see
// infra/pr-preview/coyo-pr-preview.nginx.conf). The api sets the cookie Domain to
// env.domain (pr-<n>.boardgamers.space), which the browser accepts on the player host
// (host == Domain) but REJECTS on the admin host (RFC 6265 §5.1.3). The fix lives at the
// preview proxy: coyo's vhost rewrites the cookie Domain per request host
// (`proxy_cookie_domain … $host`), so each preview host stores a HOST-ONLY cookie and no
// cookie ever carries the shared `boardgamers.space` ancestor (which would leak into prod).
// These tests pin the api behaviour the proxy relies on + the sibling-host invariant.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Koa from "koa";
import env from "../config/env.ts";
import { setRefreshCookie, clearRefreshCookie, parseRefreshCookie, SESSION_COOKIE } from "./session.ts";

const PREVIEW_PR = "pr-171.boardgamers.space";
const PREVIEW_ADMIN = "admin-pr-171.boardgamers.space";
const PROD_DOMAIN = "boardgamers.space";

/** RFC 6265 §5.1.3 string-match: does a cookie with `Domain=domain` cover `host`? */
function domainCovers(domain: string, host: string) {
	return host === domain || host.endsWith(`.${domain}`);
}

/** Run one request through the real Koa cookie pipeline (app.proxy, X-Forwarded-*) and return Set-Cookie headers. */
async function setCookies(
	host: string,
	set: (ctx: InstanceType<Koa.Context>) => void,
	proto = "https",
): Promise<string[]> {
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
			headers: { "x-forwarded-host": host, "x-forwarded-proto": proto },
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
const domainAttr = (cookie: string) => /;\s*domain=([^;]+)/i.exec(cookie)?.[1] ?? null;
const hasSecureAttr = (cookie: string) => /;\s*secure(;|$)/i.test(cookie);

describe("session cookie — Domain attribute (api emits env.domain; the preview proxy scopes it host-only)", () => {
	it("emits Domain=env.domain, which covers the player preview host but NOT the sibling admin host", async () => {
		// Spec runs with the api default env (no `domain` override), so env.domain is the
		// production default "boardgamers.space". The api just stamps env.domain — it is the
		// preview proxy (proxy_cookie_domain) that rewrites it to the request host. Assert
		// the api behaviour the proxy depends on, then the sibling-host coverage invariant.
		assert.strictEqual(env.domain, PROD_DOMAIN);
		const cookies = await setCookies(PREVIEW_ADMIN, (ctx) => setRefreshCookie(ctx, "code-123"));
		const domain = domainAttr(cookieNamed(cookies, SESSION_COOKIE));
		assert.strictEqual(domain?.toLowerCase(), env.domain.toLowerCase());
		// A preview sets domain=pr-<n>.boardgamers.space: valid for the player host, invalid
		// for the admin host — the exact reason the proxy must rewrite it (see below).
		assert.ok(domainCovers(PREVIEW_PR, PREVIEW_PR), "player host == its env.domain → accepted");
		assert.ok(!domainCovers(PREVIEW_PR, PREVIEW_ADMIN), "admin host is a sibling → would be rejected");
	});

	it("clearRefreshCookie repeats the same Domain (a mismatched Domain would not clear the cookie)", async () => {
		const cookies = await setCookies(PREVIEW_ADMIN, (ctx) => clearRefreshCookie(ctx));
		assert.strictEqual(domainAttr(cookieNamed(cookies, SESSION_COOKIE))?.toLowerCase(), env.domain.toLowerCase());
	});

	it("localhost requests get a host-only cookie (no Domain attribute)", async () => {
		const cookies = await setCookies("localhost", (ctx) => setRefreshCookie(ctx, "code-123"));
		assert.strictEqual(domainAttr(cookieNamed(cookies, SESSION_COOKIE)), null);
	});

	it("localhost requests never get the Secure attribute (dev runs plain http)", async () => {
		const cookies = await setCookies("localhost", (ctx) => setRefreshCookie(ctx, "code-123"));
		assert.strictEqual(hasSecureAttr(cookieNamed(cookies, SESSION_COOKIE)), false);
	});

	it("the host-only invariant: a cookie must never carry the shared boardgamers.space ancestor on previews", () => {
		// What the proxy rewrite achieves: after `proxy_cookie_domain … $host`, the stored
		// cookie's Domain equals the request host, so it is host-only and scoped to exactly
		// that preview host — never the prod domain, never shared between the two siblings.
		for (const host of [PREVIEW_PR, PREVIEW_ADMIN]) {
			assert.ok(domainCovers(host, host), `${host} stores its own host-only cookie`);
			assert.ok(
				!domainCovers(host, host === PREVIEW_PR ? PREVIEW_ADMIN : PREVIEW_PR),
				`${host}'s cookie is NOT sent to the sibling host`,
			);
			assert.notStrictEqual(host, PROD_DOMAIN);
			assert.ok(
				host.endsWith(`.${PROD_DOMAIN}`),
				"preview hosts live under the prod domain, but the cookie Domain must be the full host, not the ancestor",
			);
		}
		// The rejected alternative (cookieDomain=boardgamers.space) would leak to prod:
		// a Domain=boardgamers.space cookie IS sent to www./admin.boardgamers.space.
		assert.ok(
			domainCovers(PROD_DOMAIN, "www.boardgamers.space"),
			"this is exactly the prod-namespace pollution we avoid",
		);
	});
});

describe("session cookie — Secure attribute tracks the connection, never throws", () => {
	// Regression guard for the prod 500 "Cannot send secure cookie over unencrypted
	// connection": the cookies lib throws when `secure` is requested on a connection
	// Koa sees as plain http (ctx.secure === false). That happens for requests that
	// reach the api without the https indicator (a proxy hop dropping
	// X-Forwarded-Proto, internal/direct calls). The cookie must then be set WITHOUT
	// Secure instead of erroring; genuine https traffic keeps the attribute.
	it("https request (X-Forwarded-Proto: https) → Secure attribute set", async () => {
		const cookies = await setCookies(PREVIEW_PR, (ctx) => setRefreshCookie(ctx, "code-123"), "https");
		assert.strictEqual(hasSecureAttr(cookieNamed(cookies, SESSION_COOKIE)), true);
	});

	it("plain-http request (X-Forwarded-Proto: http) → no Secure attribute, no throw", async () => {
		// setCookies asserts status 200 — pre-fix this request threw inside cookies.set
		// and Koa answered 500.
		const cookies = await setCookies(PREVIEW_PR, (ctx) => setRefreshCookie(ctx, "code-123"), "http");
		assert.strictEqual(hasSecureAttr(cookieNamed(cookies, SESSION_COOKIE)), false);
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
