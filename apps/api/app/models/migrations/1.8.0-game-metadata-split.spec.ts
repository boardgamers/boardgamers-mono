// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { colls, db } from "../../config/db.ts";
import { GAME_METADATA_FIELDS } from "@bgs/models";
import { migration } from "./1.8.0-game-metadata-split.ts";

// Two versions of one game plus a second game, all carrying the pre-split
// duplicated game-level fields. v2 is the max version for `split-game` (the one
// the metadata is taken from); `other-game` checks an independent game. Inserted
// through the untyped db handle: the fixtures model the PRE-migration state, so
// they deliberately carry game-level fields the `GameVersionDoc` type no longer has.
function seedPreSplit() {
	return db()
		.collection("gameinfos")
		.insertMany([
			{
				_id: { game: "split-game", version: 1 },
				label: "Split Game (old label)",
				alias: "Old Alias",
				description: "v1 description",
				players: [2],
				viewer: { url: "//v1" },
				meta: { public: true },
			},
			{
				_id: { game: "split-game", version: 2 },
				label: "Split Game",
				alias: "Split Alias",
				description: "v2 description",
				rules: "the rules",
				links: { bgg: "https://boardgamegeek.com/boardgame/1" },
				players: [2, 3, 4],
				expansions: [{ label: "Exp", name: "exp" }],
				viewer: { url: "//v2" },
				meta: { public: true, bots: true },
			},
			{
				_id: { game: "other-game", version: 1 },
				label: "Other Game",
				players: [3],
				viewer: { url: "//other" },
				meta: { public: false },
			},
		]);
}

describe("migration 1.8.0 — game metadata/version split (#298)", () => {
	after(() => db().dropDatabase());

	beforeEach(async () => {
		await colls.gameInfos.deleteMany({});
		await colls.gameMetadatas.deleteMany({});
	});

	it("backfills one metadata doc per game from its max version and strips game-level fields off version docs", async () => {
		await seedPreSplit();

		await migration.up();

		// One metadata doc per game, taken from the max version.
		const metas = await colls.gameMetadatas.find({}).toArray();
		assert.strictEqual(metas.length, 2);
		const split = metas.find((m) => m._id === "split-game")!;
		assert.equal(split.label, "Split Game", "metadata comes from the max version (v2), not v1");
		assert.equal(split.alias, "Split Alias");
		assert.equal(split.description, "v2 description");
		assert.equal(split.rules, "the rules");
		assert.deepEqual(split.players, [2, 3, 4]);
		assert.deepEqual(split.expansions, [{ label: "Exp", name: "exp" }]);
		assert.deepEqual(split.links, { bgg: "https://boardgamegeek.com/boardgame/1" });
		const other = metas.find((m) => m._id === "other-game")!;
		assert.equal(other.label, "Other Game");
		assert.deepEqual(other.players, [3]);

		// Version docs keep only per-version fields; every game-level field is gone.
		const versions = await colls.gameInfos.find({}).toArray();
		assert.strictEqual(versions.length, 3);
		for (const v of versions) {
			for (const field of GAME_METADATA_FIELDS) {
				assert.ok(!(field in v), `version doc ${v._id.game} v${v._id.version} still has ${field}`);
			}
		}
		const v2 = versions.find((v) => v._id.game === "split-game" && v._id.version === 2)!;
		assert.deepEqual(v2.viewer, { url: "//v2" });
		assert.deepEqual(v2.meta, { public: true, bots: true });
	});

	it("is idempotent: a re-run does not overwrite an existing metadata doc nor re-strip versions", async () => {
		await seedPreSplit();
		await migration.up();

		// Simulate the admin editing metadata after the first migration run.
		await colls.gameMetadatas.updateOne({ _id: "split-game" }, { $set: { description: "edited after migration" } });

		// Re-running must not clobber the edited doc (backfill is $setOnInsert-only).
		await migration.up();
		const split = await colls.gameMetadatas.findOne({ _id: "split-game" });
		assert.equal(split!.description, "edited after migration");
		assert.equal(split!.label, "Split Game");

		// And version docs stay stripped.
		const v2 = await colls.gameInfos.findOne({ _id: { game: "split-game", version: 2 } });
		assert.ok(v2 && !("label" in v2));
	});

	it("does not create a metadata doc for a game that already has one (deploy-before-migration window)", async () => {
		// The admin upsert route can create the metadata doc before the migration runs.
		await colls.gameMetadatas.insertOne({ _id: "split-game", label: "Already There", players: [5] });
		await seedPreSplit();

		await migration.up();

		const split = await colls.gameMetadatas.findOne({ _id: "split-game" });
		assert.equal(split!.label, "Already There", "existing metadata doc is left untouched");
		assert.deepEqual(split!.players, [5]);
	});
});
