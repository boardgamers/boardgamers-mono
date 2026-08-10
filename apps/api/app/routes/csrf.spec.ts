// Global CSRF guard (review B1): cookie-authenticated mutating requests must be
// JSON and not cross-site. The session cookie is SameSite=Lax, so a cross-site
// top-level form POST would otherwise ride it and mutate the victim's account —
// the OAuth2 consent grant was the reported instance.
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { colls } from "../config/db.ts";
import env from "../config/env.ts";
import { setup } from "../config/test-setup.ts";
import { testUser } from "../config/test-helpers.ts";
import { generateRefreshCode, hashRefreshCode } from "../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

let cookieHeader: string;

before(async () => {
	await setup();
	const user = testUser();
	const { insertedId } = await colls.users.insertOne(user);
	const code = generateRefreshCode();
	await colls.jwtRefreshTokens.insertOne({
		user: insertedId,
		codeHash: hashRefreshCode(code),
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 3600 * 1000),
	});
	cookieHeader = `refreshToken=${encodeURIComponent(JSON.stringify({ code }))}`;
});

// A benign cookie-authed mutation that requires no params and no special body.
// POST /api/account/terms-and-conditions is idempotent-ish and loggedIn-gated.
const MUTATING = "/api/account/terms-and-conditions";

describe("cookie-CSRF guard (app.ts)", () => {
	it("rejects a form-urlencoded POST carrying a session cookie (cross-site form)", async () => {
		const res = await fetch(`${baseURL()}${MUTATING}`, {
			method: "POST",
			headers: {
				cookie: cookieHeader,
				"content-type": "application/x-www-form-urlencoded",
				"sec-fetch-site": "cross-site",
				origin: "https://evil.example",
			},
			body: "x=1",
		});
		assert.strictEqual(res.status, 403, await res.text());
	});

	it("rejects a cross-site JSON POST too (Sec-Fetch-Site marker)", async () => {
		const res = await fetch(`${baseURL()}${MUTATING}`, {
			method: "POST",
			headers: { cookie: cookieHeader, "content-type": "application/json", "sec-fetch-site": "cross-site" },
			body: "{}",
		});
		assert.strictEqual(res.status, 403);
	});

	it("rejects a cookie-authed form POST even with no Origin/Sec-Fetch-Site (JSON gate)", async () => {
		const res = await fetch(`${baseURL()}${MUTATING}`, {
			method: "POST",
			headers: { cookie: cookieHeader, "content-type": "application/x-www-form-urlencoded" },
			body: "x=1",
		});
		assert.strictEqual(res.status, 415, await res.text());
	});

	it("allows a same-origin JSON POST (no cross-site markers)", async () => {
		const res = await fetch(`${baseURL()}${MUTATING}`, {
			method: "POST",
			headers: { cookie: cookieHeader, "content-type": "application/json" },
			body: "{}",
		});
		// The route itself runs (may 4xx on state, but must NOT be a CSRF 403/415).
		assert.ok(![403, 415].includes(res.status), `expected the CSRF guard to pass, got ${res.status}`);
	});

	it("allows a same-site Origin whose host matches the request host", async () => {
		// On the test server the request host is 127.0.0.1, so a matching Origin passes.
		const res = await fetch(`${baseURL()}${MUTATING}`, {
			method: "POST",
			headers: {
				cookie: cookieHeader,
				"content-type": "application/json",
				origin: `http://${env.listen.host}:${env.listen.port.api}`,
			},
			body: "{}",
		});
		assert.ok(![403, 415].includes(res.status), `expected pass, got ${res.status}`);
	});

	// The domain/subdomain same-site rule is unit-tested against the exported helper
	// (an integration test can't set an arbitrary Host through fetch).
	it("isSameSiteOrigin: subdomains of the site domain count as same-site", async () => {
		const { isSameSiteOrigin } = await import("../app.ts");
		const ctx = { hostname: "boardgamers.space" };
		assert.ok(isSameSiteOrigin(ctx, "https://www.boardgamers.space"));
		assert.ok(isSameSiteOrigin(ctx, "https://boardgamers.space"));
		assert.ok(isSameSiteOrigin({ hostname: "www.boardgamers.space" }, "https://forum.boardgamers.space"));
		assert.equal(isSameSiteOrigin(ctx, "https://evil.com"), false);
		assert.equal(isSameSiteOrigin(ctx, "https://boardgamers.space.evil.com"), false);
		assert.equal(isSameSiteOrigin(ctx, "not-a-url"), false);
	});

	it("does not affect bearer-token callers (no cookie)", async () => {
		const res = await fetch(`${baseURL()}/api/account/terms-and-conditions`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: "x=1",
		});
		// No cookie → guard skipped entirely; the route's own auth answers (401 logged-out).
		assert.strictEqual(res.status, 401);
	});

	it("the OAuth2 token endpoint stays form-capable (exempt)", async () => {
		const res = await fetch(`${baseURL()}/api/oauth2/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader },
			body: "grant_type=authorization_code&code=x&redirect_uri=https%3A%2F%2Fa.b%2Fc&client_id=https%3A%2F%2Fa.b%2Fc&code_verifier=abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq",
		});
		// Not a CSRF block — the endpoint parses the form and fails the grant instead.
		assert.ok(![403, 415].includes(res.status), `token endpoint must accept form, got ${res.status}`);
	});
});
