// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { colls, db } from "../../config/db.ts";
import { migration } from "./1.9.0-hoist-public-flag.ts";

// Pre-hoist fixtures: `public` lives under `meta`. Inserted through the untyped
// db handle — they model the PRE-migration state the `GameVersionDoc` type no
// longer has.
function seedPreHoist() {
	return db()
		.collection("gameinfos")
		.insertMany([
			{
				_id: { game: "hoist-game", version: 1 },
				viewer: { url: "//v1" },
				meta: { public: true, bots: true },
			},
			{
				_id: { game: "hoist-game", version: 2 },
				viewer: { url: "//v2" },
				meta: { public: false },
			},
			{
				// Degenerate doc with no meta.public at all: left untouched.
				_id: { game: "odd-game", version: 1 },
				viewer: { url: "//odd" },
				meta: { archived: true },
			},
		]);
}

describe("migration 1.9.0 — hoist public flag out of meta", () => {
	after(() => db().dropDatabase());

	beforeEach(async () => {
		await colls.gameInfos.deleteMany({});
	});

	it("moves meta.public to a top-level public on every version doc", async () => {
		await seedPreHoist();

		await migration.up();

		const v1 = await colls.gameInfos.findOne({ _id: { game: "hoist-game", version: 1 } });
		assert.strictEqual(v1!.public, true);
		assert.deepEqual(v1!.meta, { bots: true }, "meta keeps the other version-scoped flags");

		const v2 = await colls.gameInfos.findOne({ _id: { game: "hoist-game", version: 2 } });
		assert.strictEqual(v2!.public, false, "a false flag is hoisted too, not just truthy ones");
		assert.deepEqual(v2!.meta, {});

		const odd = await colls.gameInfos.findOne({ _id: { game: "odd-game", version: 1 } });
		assert.ok(odd && !("public" in odd), "a doc without meta.public is left untouched");
		assert.deepEqual(odd.meta, { archived: true });
	});

	it("is idempotent: a re-run does not overwrite an edited flag", async () => {
		await seedPreHoist();
		await migration.up();

		// Admin flips the flag after the first run.
		await colls.gameInfos.updateOne({ _id: { game: "hoist-game", version: 1 } }, { $set: { public: false } });

		await migration.up();

		const v1 = await colls.gameInfos.findOne({ _id: { game: "hoist-game", version: 1 } });
		assert.strictEqual(v1!.public, false, "re-run does not clobber the edited flag");
	});

	it("hoists a version doc created by pre-hoist code during the deploy window", async () => {
		await seedPreHoist();
		await migration.up();

		// Pre-hoist code (still running until every process is reloaded) creates a
		// new version with meta.public; a re-run of the migration catches it.
		await db()
			.collection("gameinfos")
			.insertOne({
				_id: { game: "hoist-game", version: 3 },
				viewer: { url: "//v3" },
				meta: { public: true },
			});

		await migration.up();

		const v3 = await colls.gameInfos.findOne({ _id: { game: "hoist-game", version: 3 } });
		assert.strictEqual(v3!.public, true);
		assert.deepEqual(v3!.meta, {});
	});
});
