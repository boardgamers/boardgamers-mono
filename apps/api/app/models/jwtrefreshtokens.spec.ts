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

	it("a legacy plaintext-stored code still resolves, and is rehashed in place", async () => {
		// Pre-#164 codes were 15 random bytes base64 (length 20) — the legacy lookup path
		// is gated on that format, so use a matching code, not generateRefreshCode().
		const code = "legacy-plaintext-c0d";
		assert.strictEqual(code.length, 20);
		// Pre-#164 storage shape.
		await colls.jwtRefreshTokens.insertOne({ user: userId, code, createdAt: new Date() });

		const rt = await lookupRefreshToken(code);
		assert.ok(rt, "legacy plaintext code still authenticates");
		assert.strictEqual(rt.code, code);

		// Rehash fires fire-and-forget — poll briefly for it to land.
		let doc;
		for (let i = 0; i < 50; i++) {
			doc = await colls.jwtRefreshTokens.findOne({ _id: rt._id });
			if (doc && !("code" in doc)) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert.ok(doc && !("code" in doc), "plaintext code was removed");
		assert.strictEqual(doc.codeHash, hashRefreshCode(code), "hash stored in its place");
	});

	it("a wrong code resolves to nothing", async () => {
		assert.strictEqual(await lookupRefreshToken(generateRefreshCode()), null);
	});

	it("revokeRefreshToken deletes by raw code (hashed and legacy)", async () => {
		const hashed = generateRefreshCode();
		await colls.jwtRefreshTokens.insertOne({
			user: userId,
			codeHash: hashRefreshCode(hashed),
			createdAt: new Date(),
		});
		const legacy = "legacy-plaintext-c0e"; // length 20, pre-#164 format
		await colls.jwtRefreshTokens.insertOne({ user: userId, code: legacy, createdAt: new Date() });

		await revokeRefreshToken(hashed);
		await revokeRefreshToken(legacy);
		assert.strictEqual(await lookupRefreshToken(hashed), null);
		assert.strictEqual(await lookupRefreshToken(legacy), null);
	});
});
