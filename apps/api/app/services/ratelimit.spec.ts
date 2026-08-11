// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { colls, db } from "../config/db.ts";
import { recordAttempt } from "./ratelimit.ts";

describe("recordAttempt (sliding-window counter)", () => {
	const limit = { windowMs: 60_000, max: 3 };

	beforeEach(() => colls.authAttempts.deleteMany({}));

	it("allows up to max attempts, then rejects with a retry delay", async () => {
		for (let i = 0; i < limit.max; i++) {
			const result = await recordAttempt("test", "key", limit);
			assert.strictEqual(result.allowed, true, `attempt ${i + 1} should be allowed`);
		}
		const rejected = await recordAttempt("test", "key", limit);
		assert.strictEqual(rejected.allowed, false);
		assert.ok(rejected.retryAfterSeconds >= 1 && rejected.retryAfterSeconds <= 60);
	});

	it("counts buckets and keys independently", async () => {
		for (let i = 0; i < limit.max; i++) {
			await recordAttempt("test", "key", limit);
		}
		assert.strictEqual((await recordAttempt("other-bucket", "key", limit)).allowed, true);
		assert.strictEqual((await recordAttempt("test", "other-key", limit)).allowed, true);
	});

	it("resets once the window rolls over", async () => {
		const start = 1_700_000_010_000;
		for (let i = 0; i < limit.max; i++) {
			assert.strictEqual((await recordAttempt("test", "key", limit, start)).allowed, true);
		}
		assert.strictEqual((await recordAttempt("test", "key", limit, start)).allowed, false);
		assert.strictEqual((await recordAttempt("test", "key", limit, start + limit.windowMs)).allowed, true);
	});

	it("stamps an expiresAt the TTL index can reap after the window closes", async () => {
		const now = 1_700_000_010_000;
		await recordAttempt("test", "key", limit, now);
		const windowStart = now - (now % limit.windowMs);
		const doc = await colls.authAttempts.findOne({ _id: `test:${windowStart}:key` });
		assert.ok(doc);
		assert.strictEqual(doc.expiresAt.getTime(), windowStart + 2 * limit.windowMs);
	});

	it("counts exactly once per call under concurrent first hits", async () => {
		const results = await Promise.all([
			recordAttempt("test", "race", limit),
			recordAttempt("test", "race", limit),
			recordAttempt("test", "race", limit),
		]);
		assert.deepStrictEqual(
			results.map((r) => r.allowed),
			[true, true, true],
		);
		assert.strictEqual((await recordAttempt("test", "race", limit)).allowed, false);
		const docs = await colls.authAttempts.find({ _id: /^test:\d+:race$/ }).toArray();
		assert.strictEqual(docs.length, 1);
		assert.strictEqual(docs[0].count, 4);
	});

	after(() => db().dropDatabase());
});
