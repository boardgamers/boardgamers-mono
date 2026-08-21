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
	public: true,
	meta: { bots: true },
};

const metadataDoc: GameMetadataDoc = {
	_id: "splendor",
	label: "💎 Splendor",
	alias: "Gem Trader",
	description: "a description",
	players: [2, 3, 4],
	likeCount: 7,
};

const translatedMetadataDoc: GameMetadataDoc = {
	...metadataDoc,
	rules: "EN rules",
	credits: "EN credits",
	translations: {
		de: { description: "Deutsche Beschreibung", credits: "DE Credits" },
	},
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
		assert.equal(merged.public, true);
		assert.deepEqual(merged.meta, { bots: true });
		assert.deepEqual(merged._id, { game: "splendor", version: 2 });
	});
});

describe("mergeGameInfo translations (#306)", () => {
	it("never leaks the translations map onto the merged doc", () => {
		const merged = mergeGameInfo(versionDoc, translatedMetadataDoc)!;
		assert.strictEqual("translations" in merged, false);
		const mergedDe = mergeGameInfo(versionDoc, translatedMetadataDoc, "de")!;
		assert.strictEqual("translations" in mergedDe, false);
	});

	it("without lang (or lang en), the merge is identical to the pre-#306 shape", () => {
		const plain = mergeGameInfo(versionDoc, translatedMetadataDoc)!;
		const en = mergeGameInfo(versionDoc, translatedMetadataDoc, "en")!;
		assert.deepEqual(en, plain);
		assert.equal(plain.description, "a description");
		assert.equal(plain.rules, "EN rules");
		assert.equal(plain.credits, "EN credits");
	});

	it("overlays translations[lang] with per-field en fallback", () => {
		const merged = mergeGameInfo(versionDoc, translatedMetadataDoc, "de")!;
		assert.equal(merged.description, "Deutsche Beschreibung");
		assert.equal(merged.credits, "DE Credits");
		assert.equal(merged.rules, "EN rules", "a field missing from translations[de] falls back to the base text");
	});

	it("falls back to the base text for a language without any translation entry", () => {
		const merged = mergeGameInfo(versionDoc, translatedMetadataDoc, "fr")!;
		assert.equal(merged.description, "a description");
		assert.equal(merged.rules, "EN rules");
	});
});
