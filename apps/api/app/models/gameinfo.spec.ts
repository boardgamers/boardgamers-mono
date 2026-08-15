// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameMetadataDoc, GameVersionDoc } from "@bgs/models";
import { mergeGameInfo } from "./gameinfo.ts";

const versionDoc: GameVersionDoc = {
	_id: { game: "splendor", version: 2 },
	viewer: { url: "//v2" },
	meta: { public: true, bots: true },
};

const metadataDoc: GameMetadataDoc = {
	_id: "splendor",
	label: "💎 Splendor",
	alias: "Gem Trader",
	description: "a description",
	players: [2, 3, 4],
	likeCount: 7,
};

describe("mergeGameInfo (#298)", () => {
	it("returns null when there is no version doc", () => {
		assert.strictEqual(mergeGameInfo(null, metadataDoc), null);
		assert.strictEqual(mergeGameInfo(null, null), null);
	});

	it("merges the version doc with its game metadata (metadata fields win, likeCount surfaces)", () => {
		const merged = mergeGameInfo(versionDoc, metadataDoc)!;
		assert.equal(merged.label, "💎 Splendor");
		assert.equal(merged.alias, "Gem Trader");
		assert.equal(merged.description, "a description");
		assert.deepEqual(merged.players, [2, 3, 4]);
		assert.equal(merged.likeCount, 7, "game-scoped likeCount surfaces on the merged game-info");
		// Version-scoped fields come from the version doc.
		assert.deepEqual(merged.viewer, { url: "//v2" });
		assert.deepEqual(merged.meta, { public: true, bots: true });
		assert.deepEqual(merged._id, { game: "splendor", version: 2 });
	});

	// Deploy-before-migration tolerance: migrations run on api-cron boot AFTER code
	// ships, so there's a window where `gameMetadatas` is empty and the version doc
	// still carries the (duplicated) game-level fields. mergeGameInfo must serve the
	// full GameInfo from the bare version doc then.
	it("deploy-tolerance: a null metadata doc falls back to the pre-migration version doc's game-level fields", () => {
		const preMigrationVersionDoc = {
			...versionDoc,
			label: "💎 Splendor",
			alias: "Gem Trader",
			description: "a description",
			players: [2, 3, 4],
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- pre-migration version docs still carry the game-level fields
		} as GameVersionDoc;

		const merged = mergeGameInfo(preMigrationVersionDoc, null)!;
		assert.equal(merged.label, "💎 Splendor");
		assert.equal(merged.alias, "Gem Trader");
		assert.equal(merged.description, "a description");
		assert.deepEqual(merged.players, [2, 3, 4]);
		assert.deepEqual(merged.viewer, { url: "//v2" });
	});
});
