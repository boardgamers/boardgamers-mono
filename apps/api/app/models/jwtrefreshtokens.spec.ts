// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../config/db.ts";
import { testUser } from "../config/test-helpers.ts";
import { generateRefreshCode, hashRefreshCode, lookupRefreshToken, revokeRefreshToken } from "./jwtrefreshtokens.ts";

describe("refresh-token codes — stored hashed, not plaintext (#164)", () => {
	const userId = new ObjectId();

	before(async () => {
		await colls.users.insertOne(testUser({ _id: userId }));
	});

	after(() => db().dropDatabase());

	it("hashRefreshCode matches the admintoken scheme (unsalted sha256 hex)", () => {
		const hash = hashRefreshCode("some code");
		assert.match(hash, /^[0-9a-f]{64}$/);
		assert.strictEqual(hash, hashRefreshCode("some code"));
		assert.notStrictEqual(hash, hashRefreshCode("some other code"));
	});

	it("lookupRefreshToken finds a hashed code, and the raw code is nowhere in the doc", async () => {
		const code = generateRefreshCode();
		await colls.jwtRefreshTokens.insertOne({ user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() });

		const rt = await lookupRefreshToken(code);
		assert.ok(rt, "lookup by raw code resolves");
		assert.deepStrictEqual(rt.user, userId);
		assert.strictEqual(rt.codeHash, hashRefreshCode(code));
		assert.ok(!("code" in rt), "no plaintext code field");
		assert.ok(!JSON.stringify(rt).includes(code), "raw code is stored nowhere");
	});

	it("a wrong code resolves to nothing", async () => {
		assert.strictEqual(await lookupRefreshToken(generateRefreshCode()), null);
	});

	it("revokeRefreshToken deletes by raw code", async () => {
		const code = generateRefreshCode();
		await colls.jwtRefreshTokens.insertOne({
			user: userId,
			codeHash: hashRefreshCode(code),
			createdAt: new Date(),
		});

		await revokeRefreshToken(code);
		assert.strictEqual(await lookupRefreshToken(code), null);
	});
});
