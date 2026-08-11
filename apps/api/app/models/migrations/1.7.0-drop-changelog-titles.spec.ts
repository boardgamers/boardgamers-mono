// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import { migration } from "./1.7.0-drop-changelog-titles.ts";

describe("migration 1.7.0 — drop changelog titles", () => {
	after(() => db().dropDatabase());

	beforeEach(() => colls.changelogs.deleteMany({}));

	it("unsets title on seeded entries and leaves the rest of the doc untouched", async () => {
		await colls.changelogs.insertMany([
			{
				_id: new ObjectId(),
				title: "Recent changes",
				content: "a feature",
				published: true,
				createdAt: new Date(),
			},
			{
				_id: new ObjectId(),
				title: "Recent changes",
				content: "b bugfixes",
				details: "Some details",
				published: false,
				createdAt: new Date(),
			},
		]);

		await migration.up();

		const entries = await colls.changelogs.find({}).sort({ content: 1 }).toArray();
		assert.strictEqual(entries.length, 2);
		assert.ok(entries.every((e) => !("title" in e)));
		assert.equal(entries[1].details, "Some details");
		assert.equal(entries[1].published, false);
	});

	it("is idempotent: re-running is a no-op, and title-less entries are skipped", async () => {
		await colls.changelogs.insertOne({
			_id: new ObjectId(),
			content: "already migrated",
			published: true,
			createdAt: new Date(),
		});

		await migration.up();
		await migration.up();

		const entries = await colls.changelogs.find({}).toArray();
		assert.strictEqual(entries.length, 1);
		assert.equal(entries[0].content, "already migrated");
	});
});
