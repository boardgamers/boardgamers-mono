import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gameMetadataSchema, gameMetadataTranslationsSchema, gameOptionTranslationsSchema } from "./gameinfo.ts";

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
		const doc = gameMetadataSchema.parse({
			...baseDoc,
			translations: {
				de: { description: "Deutsche Beschreibung", translatedFrom: { hash: "0123456789abcdef" } },
				fr: { description: "Description française" }, // legacy overlay: no stamp
			},
		});
		assert.strictEqual(doc.translations?.de?.translatedFrom?.hash, "0123456789abcdef");
		assert.strictEqual(doc.translations?.fr?.translatedFrom, undefined);
	});

	it("rejects a malformed translatedFrom", () => {
		assert.strictEqual(
			gameMetadataTranslationsSchema.safeParse({ de: { translatedFrom: { hash: 42 } } }).success,
			false,
		);
		assert.strictEqual(gameMetadataTranslationsSchema.safeParse({ de: { translatedFrom: {} } }).success, false);
	});
});

describe("gameMetadataSchema optionTranslations (#306 follow-up)", () => {
	const baseDoc = { _id: "splendor", label: "💎 Splendor", players: [2, 3, 4] };

	it("accepts a per-language map of dotted overlay keys with per-string stamps", () => {
		const doc = gameMetadataSchema.parse({
			...baseDoc,
			optionTranslations: {
				fr: {
					"options.balanced": { label: "Équilibré", translatedFrom: { hash: "0123456789abcdef" } },
					"options.map.items.random": { label: "Aléatoire", translatedFrom: { hash: "fedcba9876543210" } },
					"expansions.cities": { label: "Les Cités" }, // stamp-less (manual write)
				},
			},
		});
		assert.strictEqual(doc.optionTranslations?.fr?.["options.balanced"]?.label, "Équilibré");
		assert.strictEqual(doc.optionTranslations?.fr?.["options.balanced"]?.translatedFrom?.hash, "0123456789abcdef");
		assert.strictEqual(doc.optionTranslations?.fr?.["expansions.cities"]?.translatedFrom, undefined);
	});

	it("rejects non-base-subtag language keys and junk entries", () => {
		assert.strictEqual(
			gameOptionTranslationsSchema.safeParse({ "fr-CA": { "options.x": { label: "y" } } }).success,
			false,
		);
		assert.strictEqual(gameOptionTranslationsSchema.safeParse({ fr: { "options.x": "y" } }).success, false);
		assert.strictEqual(gameOptionTranslationsSchema.safeParse({ fr: { "options.x": { label: 42 } } }).success, false);
	});
});
