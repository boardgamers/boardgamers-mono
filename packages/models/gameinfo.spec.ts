import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gameMetadataSchema, gameMetadataTranslationsSchema } from "./gameinfo.ts";

describe("gameMetadataSchema translations (#306)", () => {
	const baseDoc = { _id: "splendor", label: "💎 Splendor", players: [2, 3, 4] };

	it("accepts a doc without translations (pre-#306 shape)", () => {
		const doc = gameMetadataSchema.parse(baseDoc);
		assert.strictEqual(doc.translations, undefined);
	});

	it("accepts a valid translations map, keyed by base subtag", () => {
		const doc = gameMetadataSchema.parse({
			...baseDoc,
			translations: {
				de: { description: "Deutsche Beschreibung", rules: "Regeln" },
				fr: { credits: "Crédits" },
			},
		});
		assert.strictEqual(doc.translations?.de?.description, "Deutsche Beschreibung");
		assert.strictEqual(doc.translations?.de?.rules, "Regeln");
		assert.strictEqual(doc.translations?.de?.credits, undefined);
		assert.strictEqual(doc.translations?.fr?.credits, "Crédits");
	});

	it("rejects non-base-subtag keys", () => {
		for (const key of ["de-AT", "DE", "english", "d", "de1", "en-US"]) {
			const res = gameMetadataTranslationsSchema.safeParse({ [key]: { description: "x" } });
			assert.strictEqual(res.success, false, `key "${key}" must be rejected`);
		}
	});

	it("rejects junk shapes", () => {
		assert.strictEqual(gameMetadataTranslationsSchema.safeParse({ de: "a string" }).success, false);
		assert.strictEqual(gameMetadataTranslationsSchema.safeParse({ de: { description: 42 } }).success, false);
		assert.strictEqual(gameMetadataTranslationsSchema.safeParse("de").success, false);
	});

	it("accepts overlays with and without translatedFrom (outdated-tracking)", () => {
		// zDate takes the wire shape (ISO string) and outputs a Date.
		const stamped = new Date().toISOString();
		const doc = gameMetadataSchema.parse({
			...baseDoc,
			translations: {
				de: { description: "Deutsche Beschreibung", translatedFrom: { updatedAt: stamped } },
				fr: { description: "Description française" }, // legacy overlay: no stamp
			},
		});
		assert.strictEqual(doc.translations?.de?.translatedFrom?.updatedAt.getTime(), new Date(stamped).getTime());
		assert.strictEqual(doc.translations?.fr?.translatedFrom, undefined);
	});

	it("rejects a malformed translatedFrom", () => {
		assert.strictEqual(
			gameMetadataTranslationsSchema.safeParse({ de: { translatedFrom: { updatedAt: "yesterday" } } }).success,
			false,
		);
		assert.strictEqual(gameMetadataTranslationsSchema.safeParse({ de: { translatedFrom: {} } }).success, false);
	});
});
