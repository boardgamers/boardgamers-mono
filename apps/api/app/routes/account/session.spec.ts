// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { generateRefreshCode, hashRefreshCode, lookupRefreshToken } from "../../models/jwtrefreshtokens.ts";
import { parseRefreshCookie } from "../../models/session.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function exchange(code: string) {
	const res = await fetch(`${baseURL()}/api/account/session`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code }),
	});
	return {
		status: res.status,
		data: res.headers.get("content-type")?.includes("json") ? await res.json() : null,
		setCookie: res.headers.getSetCookie(),
	};
}

describe("POST /account/session — one-time code exchange (admin login-as handoff)", () => {
	const userId = new ObjectId();
	const code = generateRefreshCode();

	before(async () => {
		await colls.users.insertOne(
			testUser({
				_id: userId,
				account: { username: "handoff-target", email: "handoff-target@test.com" },
				security: { slug: "handoff-target" },
			}),
		);
		await colls.jwtRefreshTokens.insertOne({
			user: userId,
			codeHash: hashRefreshCode(code),
			loginMethod: "admin",
			createdAt: new Date(),
		});
	});

	it("exchanges a valid code for a session cookie + tokens, rotating the code", async () => {
		const res = await exchange(code);
		assert.strictEqual(res.status, 200);
		assert.equal(res.data.user.account.username, "handoff-target");
		assert.ok(res.data.accessToken?.code, "an access token is minted");
		assert.ok(res.data.refreshToken?.code, "a fresh refresh code is returned");
		assert.notEqual(res.data.refreshToken.code, code, "the session is rotated");

		const cookie = res.setCookie.find((header) => header.startsWith("refreshToken="));
		assert.ok(cookie, "the session cookie is set on this host");
		assert.ok(!cookie.includes("Domain="), "the cookie is host-only");
		const cookieCode = parseRefreshCookie(cookie.slice("refreshToken=".length).split(";")[0]);
		assert.equal(cookieCode, res.data.refreshToken.code, "cookie and body carry the same session");

		const session = await lookupRefreshToken(res.data.refreshToken.code);
		assert.ok(session, "the fresh session is stored");
		assert.equal(session.loginMethod, "admin", "the login method is preserved across the exchange");
	});

	it("the old code is revoked — a replay 404s", async () => {
		const res = await exchange(code);
		assert.strictEqual(res.status, 404);
	});

	it("concurrent exchanges of the same code: exactly one wins (atomic single-use)", async () => {
		const raceCode = generateRefreshCode();
		await colls.jwtRefreshTokens.insertOne({
			user: userId,
			codeHash: hashRefreshCode(raceCode),
			loginMethod: "admin",
			createdAt: new Date(),
		});

		const results = await Promise.all(Array.from({ length: 5 }, () => exchange(raceCode)));
		assert.deepEqual(
			results.map((r) => r.status).sort((a, b) => a - b),
			[200, 404, 404, 404, 404],
			"one exchange mints a session, the rest 404",
		);
	});

	it("an unknown code 404s and sets no cookie", async () => {
		const res = await exchange(generateRefreshCode());
		assert.strictEqual(res.status, 404);
		assert.ok(!res.setCookie.some((header) => header.startsWith("refreshToken=")));
	});
});
