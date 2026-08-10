import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { colls, db } from "../config/db.ts";
import { testUser } from "../config/test-helpers.ts";
import { migration as unsetEmptyUserEmails } from "./migrations/1.4.1-unset-empty-user-emails.ts";
import { confirm, generateResetLink, hashUserSecret, validateResetKey } from "./user.ts";

// Regression: makeDefaultUser used to hardcode social: { google: "", facebook: "", discord: "", github: "" }
// for every user. The unique *sparse* indexes on those fields skip null/missing but NOT empty
// string, so the second user inserted with google: "" collided on the index → duplicate-key
// error on signup/join. Unconnected providers must be absent, not "".
describe("makeDefaultUser", () => {
	it("lets two users with no connected social account coexist", async () => {
		const { insertedCount } = await colls.users.insertMany([testUser(), testUser()]);
		assert.strictEqual(insertedCount, 2);
	});

	it("lets two users with NO email coexist (no E11000 on the sparse account.email index)", async () => {
		// delete, not `email: undefined`: the driver serializes an explicit undefined as
		// null, and the sparse index indexes null — only an ABSENT field is skipped.
		// (This is how a social signup with no provider email builds its doc.)
		const noEmail = [testUser(), testUser()];
		for (const user of noEmail) {
			delete user.account.email;
		}
		const { insertedCount } = await colls.users.insertMany(noEmail);
		assert.strictEqual(insertedCount, 2);

		// The collection is NOT empty here (earlier tests in this describe added users)
		// and after() only runs at the end — filter to the docs this test inserted.
		const users = await colls.users
			.find({ "account.username": { $in: noEmail.map((u) => u.account.username) } })
			.toArray();
		assert.strictEqual(users.length, 2);
		for (const user of users) {
			assert.ok(!("email" in user.account), 'account.email must be absent, not "" or null');
		}
	});

	it("lets a social account be linked later ($set on account.social.<provider>)", async () => {
		const { insertedId } = await colls.users.insertOne(testUser());
		const { modifiedCount } = await colls.users.updateOne(
			{ _id: insertedId },
			{ $set: { "account.social.github": "gh-1" } },
		);
		assert.strictEqual(modifiedCount, 1);
	});

	it("does not write empty-string placeholders for unconnected providers", async () => {
		const users = await colls.users.find({}, { projection: { "account.social": 1 } }).toArray();
		for (const user of users) {
			const social = user.account?.social ?? {};
			for (const provider of ["google", "facebook", "discord", "github", "huggingface"] as const) {
				assert.ok(
					!(provider in social) || typeof social[provider] === "undefined" || social[provider] !== "",
					`account.social.${provider} must not be the empty string (got ${JSON.stringify(social[provider])})`,
				);
			}
		}
	});

	it("migration 1.4.1 $unsets legacy empty-string emails and leaves real ones alone", async () => {
		const legacy = testUser();
		delete legacy.account.email;
		legacy.account.email = "";
		const { insertedId: emptyId } = await colls.users.insertOne(legacy);
		const { insertedId: realId } = await colls.users.insertOne(testUser({ account: { email: "real@test.com" } }));

		await unsetEmptyUserEmails.up();

		const cleaned = await colls.users.findOne({ _id: emptyId });
		assert.ok(cleaned);
		assert.ok(!("email" in cleaned.account), 'the "" email must be $unset');
		const untouched = await colls.users.findOne({ _id: realId });
		assert.strictEqual(untouched?.account.email, "real@test.com");
	});

	it("stores only whitelisted display fields in account.socialMeta", async () => {
		const { insertedId } = await colls.users.insertOne(
			testUser({
				account: {
					social: { github: "gh-meta-1" },
					socialMeta: { github: { username: "octocat", url: "https://github.com/octocat" } },
				},
			}),
		);
		const user = await colls.users.findOne({ _id: insertedId });
		assert.deepStrictEqual(user?.account.socialMeta, {
			github: { username: "octocat", url: "https://github.com/octocat" },
		});
	});

	after(() => db().dropDatabase());
});

// #164: the single-use emailed secrets must not be stored in plaintext — a db read
// must not hand out working confirm/reset links.
describe("user secrets — confirmKey & reset.key stored hashed (#164)", () => {
	it("generateResetLink stores only the hash; the plaintext stays on the in-memory doc for the email", async () => {
		const { insertedId } = await colls.users.insertOne(testUser());
		const user = (await colls.users.findOne({ _id: insertedId }))!;

		await generateResetLink(user);

		const plaintext = user.security.reset!.key!;
		const stored = (await colls.users.findOne({ _id: insertedId }))!;
		assert.match(stored.security.reset!.key!, /^[0-9a-f]{64}$/, "stored reset key is a sha256 hex");
		assert.strictEqual(stored.security.reset!.key, hashUserSecret(plaintext));
		assert.notStrictEqual(stored.security.reset!.key, plaintext, "no plaintext at rest");
	});

	it("validateResetKey accepts the correct key and rejects wrong/missing ones, expiry intact", async () => {
		const { insertedId } = await colls.users.insertOne(testUser());
		const user = (await colls.users.findOne({ _id: insertedId }))!;
		await generateResetLink(user);
		const plaintext = user.security.reset!.key!;

		// Correct key validates against a fresh db load (hash-on-lookup).
		const fresh = (await colls.users.findOne({ _id: insertedId }))!;
		validateResetKey(fresh, plaintext);

		assert.throws(() => validateResetKey(fresh, "wrong-key"), /reset password link is wrong/);

		const noReset = (await colls.users.findOne({ _id: (await colls.users.insertOne(testUser())).insertedId }))!;
		assert.throws(() => validateResetKey(noReset, plaintext), /didn't ask for a password reset/);

		// Expired link (>24h since issued) still fails even with the right key.
		await colls.users.updateOne(
			{ _id: insertedId },
			{ $set: { "security.reset.issued": new Date(Date.now() - 25 * 3600 * 1000) } },
		);
		const expired = (await colls.users.findOne({ _id: insertedId }))!;
		assert.throws(() => validateResetKey(expired, plaintext), /reset link has expired/);
	});

	it("confirm() works against a stored hash, nulls the key, and rejects a wrong key", async () => {
		const key = "email-link-plaintext-key";
		const { insertedId } = await colls.users.insertOne(
			testUser({ security: { confirmed: false, confirmKey: hashUserSecret(key) } }),
		);
		const user = (await colls.users.findOne({ _id: insertedId }))!;
		assert.strictEqual(user.security.confirmKey, hashUserSecret(key), "stored hashed");

		await confirm(user, key);
		const after1 = (await colls.users.findOne({ _id: insertedId }))!;
		assert.strictEqual(after1.security.confirmed, true);
		assert.strictEqual(after1.security.confirmKey, null);

		const { insertedId: otherId } = await colls.users.insertOne(
			testUser({ security: { confirmed: false, confirmKey: hashUserSecret(key) } }),
		);
		const other = (await colls.users.findOne({ _id: otherId }))!;
		await assert.rejects(confirm(other, "wrong-key"), /Wrong confirm link/);
	});

	it("hashUserSecret matches the admintoken scheme (unsalted sha256 hex)", () => {
		assert.match(hashUserSecret("x"), /^[0-9a-f]{64}$/);
		assert.strictEqual(hashUserSecret("x"), hashUserSecret("x"));
		assert.notStrictEqual(hashUserSecret("x"), hashUserSecret("y"));
	});

	after(() => db().dropDatabase());
});
