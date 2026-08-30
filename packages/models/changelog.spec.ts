import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changelogSchema, changelogTranslationsSchema } from "./changelog.ts";

describe("changelogSchema translations (#306 follow-up)", () => {
	const baseDoc = { content: "🎉 New feature", published: true };

	it("accepts a doc without translations (pre-i18n shape)", () => {
		const doc = changelogSchema.parse(baseDoc);
		assert.strictEqual(doc.translations, undefined);
	});

	it("accepts a valid translations map, keyed by base subtag", () => {
		const doc = changelogSchema.parse({
			...baseDoc,
			details: "Longer text",
			translations: {
				de: { content: "🎉 Neues Feature", details: "Längerer Text", translatedFrom: { hash: "abc123" } },
				fr: { content: "🎉 Nouvelle fonctionnalité" },
			},
		});
		assert.strictEqual(doc.translations?.de?.content, "🎉 Neues Feature");
		assert.strictEqual(doc.translations?.de?.translatedFrom?.hash, "abc123");
		assert.strictEqual(doc.translations?.fr?.content, "🎉 Nouvelle fonctionnalité");
		assert.strictEqual(doc.translations?.fr?.details, undefined);
		assert.strictEqual(doc.translations?.fr?.translatedFrom, undefined);
	});

	it("rejects non-base-subtag keys (regional variants are overkill for changelogs)", () => {
		for (const key of ["pt-BR", "DE", "english", "d", "de1", "en-US"]) {
			const res = changelogTranslationsSchema.safeParse({ [key]: { content: "x" } });
			assert.strictEqual(res.success, false, `key "${key}" must be rejected`);
		}
	});

	it("rejects junk shapes", () => {
		assert.strictEqual(changelogTranslationsSchema.safeParse({ de: "a string" }).success, false);
		assert.strictEqual(changelogTranslationsSchema.safeParse({ de: { content: 42 } }).success, false);
		assert.strictEqual(changelogTranslationsSchema.safeParse({ de: { translatedFrom: {} } }).success, false);
	});
});
