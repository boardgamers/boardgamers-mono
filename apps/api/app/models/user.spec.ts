import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { colls, db } from "../config/db.ts";
import { testUser } from "../config/test-helpers.ts";

// Regression: makeDefaultUser used to hardcode social: { google: "", facebook: "", discord: "", github: "" }
// for every user. The unique *sparse* indexes on those fields skip null/missing but NOT empty
// string, so the second user inserted with google: "" collided on the index → duplicate-key
// error on signup/join. Unconnected providers must be absent, not "".
describe("makeDefaultUser", () => {
	it("lets two users with no connected social account coexist", async () => {
		const { insertedCount } = await colls.users.insertMany([testUser(), testUser()]);
		assert.strictEqual(insertedCount, 2);
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
			for (const provider of ["google", "facebook", "discord", "github"] as const) {
				assert.ok(
					!(provider in social) || typeof social[provider] === "undefined" || social[provider] !== "",
					`account.social.${provider} must not be the empty string (got ${JSON.stringify(social[provider])})`,
				);
			}
		}
	});

	after(() => db().dropDatabase());
});
