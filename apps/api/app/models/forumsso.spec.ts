// Forum SSO `token` cookie (issue #152): the response middleware used to re-sign a
// fresh JWT (RS256 in prod) on EVERY authenticated request, and the logout clear
// missed the Domain variant of the cookie, leaving a stale shadow behind. These
// tests pin the re-issue window (only when absent/invalid/drifted or under half
// the token's life remains) and the dual-variant clear (a Set-Cookie clear only
// matches identical name+domain+path, so both variants must be expired).
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import jwt from "jsonwebtoken";
import Koa from "koa";
import type { WithId } from "mongodb";
import type { UserDoc } from "@bgs/models";
import { ObjectId } from "mongodb";
import env from "../config/env.ts";
import { testUser } from "../config/test-helpers.ts";
import {
	FORUM_SSO_COOKIE,
	FORUM_SSO_TOKEN_DURATION_S,
	clearForumSsoCookie,
	reissueForumSsoCookieIfNeeded,
} from "./forumsso.ts";

function makeUser(overrides: { username?: string; email?: string } = {}): WithId<UserDoc> {
	return { ...testUser({ account: overrides }), _id: new ObjectId() } as WithId<UserDoc>;
}

/** Fresh JWT value as the middleware would set it. `ageS` backdates iat/exp. */
function signSsoToken(user: WithId<UserDoc>, ageS = 0, key: string | Buffer = env.jwt.keys.private) {
	const nowS = Math.floor(Date.now() / 1000);
	return jwt.sign(
		{
			id: user._id.toString(),
			username: user.account.username,
			email: user.account.email,
			iat: nowS - ageS,
			exp: nowS - ageS + FORUM_SSO_TOKEN_DURATION_S,
		},
		key,
		{ algorithm: env.jwt.algorithm, noTimestamp: true },
	);
}

/** Run one request through the real Koa cookie pipeline and return Set-Cookie headers. */
async function runMiddleware(opts: { host?: string; user?: WithId<UserDoc>; cookie?: string }): Promise<string[]> {
	const app = new Koa();
	app.proxy = true; // as apps/api/app/app.ts
	app.keys = ["test-secret"];
	app.use((ctx) => {
		if (opts.user) {
			reissueForumSsoCookieIfNeeded(ctx, opts.user);
		} else {
			clearForumSsoCookie(ctx);
		}
		ctx.body = "ok";
	});
	const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
		const s = app.listen(0, "127.0.0.1", () => resolve(s));
	});
	const addr = server.address();
	const port = typeof addr === "object" && addr ? addr.port : 0;
	try {
		const headers: Record<string, string> = { "x-forwarded-host": opts.host ?? "127.0.0.1" };
		if (opts.cookie) {
			headers.cookie = `${FORUM_SSO_COOKIE}=${opts.cookie}`;
		}
		const res = await fetch(`http://127.0.0.1:${port}/`, { headers });
		assert.strictEqual(res.status, 200);
		return res.headers.getSetCookie();
	} finally {
		server.close();
	}
}

const ssoCookies = (cookies: string[]) => cookies.filter((c) => c.startsWith(`${FORUM_SSO_COOKIE}=`));
const domainAttr = (cookie: string) => /;\s*domain=([^;]+)/i.exec(cookie)?.[1] ?? null;

describe("forum SSO cookie — re-issue window (#152)", () => {
	it("sets the cookie when the request has none, with the same shape as before", async () => {
		const user = makeUser({ username: "sso", email: "sso@test.com" });
		const cookies = ssoCookies(await runMiddleware({ user }));
		assert.strictEqual(cookies.length, 1);
		const [value] = cookies[0].split(";");
		const decoded = jwt.verify(value.slice(`${FORUM_SSO_COOKIE}=`.length), env.jwt.keys.public);
		assert.ok(typeof decoded === "object");
		assert.deepStrictEqual(
			{ id: decoded.id, username: decoded.username, email: decoded.email },
			{ id: user._id.toString(), username: "sso", email: "sso@test.com" },
		);
		assert.strictEqual(decoded.exp! - decoded.iat!, FORUM_SSO_TOKEN_DURATION_S);
		assert.match(cookies[0], /httponly/i);
		// Not production in tests → host-only cookie, as before.
		assert.strictEqual(domainAttr(cookies[0]), null);
	});

	it("keeps a fresh incoming cookie (more than half its life left) — no re-sign, no Set-Cookie", async () => {
		const user = makeUser();
		const cookies = await runMiddleware({ user, cookie: signSsoToken(user, 10 * 60) });
		assert.deepStrictEqual(ssoCookies(cookies), []);
	});

	it("re-issues once under half the token's life remains", async () => {
		const user = makeUser();
		const stale = signSsoToken(user, FORUM_SSO_TOKEN_DURATION_S / 2 + 60);
		const cookies = ssoCookies(await runMiddleware({ user, cookie: stale }));
		assert.strictEqual(cookies.length, 1);
		const [value] = cookies[0].split(";");
		assert.notStrictEqual(value, `${FORUM_SSO_COOKIE}=${stale}`);
		const decoded = jwt.verify(value.slice(`${FORUM_SSO_COOKIE}=`.length), env.jwt.keys.public);
		assert.ok(typeof decoded === "object" && typeof decoded.exp === "number");
		assert.ok(decoded.exp - Math.floor(Date.now() / 1000) > FORUM_SSO_TOKEN_DURATION_S / 2);
	});

	it("re-issues when the incoming cookie is invalid, expired, or its payload drifted", async () => {
		const user = makeUser({ username: "newname", email: "new@test.com" });

		// Garbage value
		assert.strictEqual(ssoCookies(await runMiddleware({ user, cookie: "not-a-jwt" })).length, 1);
		// Valid JWT but wrong key
		assert.strictEqual(ssoCookies(await runMiddleware({ user, cookie: signSsoToken(user, 0, "wrong-key") })).length, 1);
		// Expired
		assert.strictEqual(
			ssoCookies(await runMiddleware({ user, cookie: signSsoToken(user, FORUM_SSO_TOKEN_DURATION_S + 60) })).length,
			1,
		);
		// Payload drift (username changed since the cookie was minted)
		const staleName = signSsoToken(makeUser({ username: "oldname", email: "new@test.com" }));
		assert.strictEqual(ssoCookies(await runMiddleware({ user, cookie: staleName })).length, 1);
	});
});

describe("forum SSO cookie — logout clear (#152)", () => {
	it("non-production: a single host-only clear", async () => {
		const cookies = ssoCookies(await runMiddleware({}));
		assert.strictEqual(cookies.length, 1);
		assert.match(cookies[0], /expires=Thu, 01 Jan 1970/i);
		assert.strictEqual(domainAttr(cookies[0]), null);
	});

	it("production: expires BOTH the Domain=env.domain and the host-only variant", async () => {
		env.isProduction = true;
		try {
			const cookies = ssoCookies(await runMiddleware({ host: "www.boardgamers.space" }));
			assert.strictEqual(cookies.length, 2, `expected two clear headers, got: ${cookies.join(" | ")}`);
			const domains = cookies.map(domainAttr).map((d) => d?.toLowerCase() ?? null);
			assert.ok(domains.includes(env.domain.toLowerCase()), `missing Domain=${env.domain} clear: ${cookies.join()}`);
			assert.ok(domains.includes(null), `missing host-only clear: ${cookies.join()}`);
			for (const cookie of cookies) {
				assert.match(cookie, /expires=Thu, 01 Jan 1970/i);
			}
			// The set path must stamp the same Domain, or the clear can't match it.
			const set = ssoCookies(await runMiddleware({ host: "www.boardgamers.space", user: makeUser() }));
			assert.strictEqual(domainAttr(set[0])?.toLowerCase(), env.domain.toLowerCase());
		} finally {
			env.isProduction = false;
		}
	});
});

// Guard against accidentally leaving env mutated for the rest of the suite.
after(() => {
	assert.strictEqual(env.isProduction, false);
});
