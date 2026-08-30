// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import {
	applyChangelogTranslation,
	changelogNeedsTranslation,
	changelogSourceHash,
	changelogSourceStrings,
	changelogTargetLangs,
} from "./changelog-i18n.ts";

const entry = (overrides: object = {}) => ({
	_id: new ObjectId(),
	content: "EN content",
	details: "EN details",
	published: true,
	...overrides,
});

describe("changelog i18n helpers (#306 follow-up)", () => {
	it("changelogSourceStrings keeps only non-empty content/details", () => {
		assert.deepEqual(changelogSourceStrings({ content: "c", details: "d" }), { content: "c", details: "d" });
		assert.deepEqual(changelogSourceStrings({ content: "c" }), { content: "c" });
		assert.deepEqual(changelogSourceStrings({ content: "c", details: "" }), { content: "c" });
	});

	it("changelogSourceHash only moves when the source text changes (revert restores it)", () => {
		const before = changelogSourceHash(changelogSourceStrings(entry()));
		assert.strictEqual(before, changelogSourceHash(changelogSourceStrings(entry())));
		const edited = changelogSourceHash(changelogSourceStrings(entry({ content: "edited" })));
		assert.notStrictEqual(before, edited);
		// details growing/disappearing moves the hash too.
		assert.notStrictEqual(before, changelogSourceHash(changelogSourceStrings(entry({ details: undefined }))));
	});

	it("changelogTargetLangs is the base-subtag locale set minus English", () => {
		const langs = changelogTargetLangs();
		assert.ok(!langs.includes("en"));
		assert.ok(langs.includes("de"));
		assert.ok(langs.includes("pt"), "pt-BR collapses to its base subtag");
		assert.ok(!langs.includes("pt-BR"));
	});

	it("changelogNeedsTranslation: missing → yes; fresh stamp → no; stale stamp → yes; unstamped → no", () => {
		const doc = entry();
		const hash = changelogSourceHash(changelogSourceStrings(doc));
		assert.strictEqual(changelogNeedsTranslation(doc, "de"), true, "missing overlay");
		assert.strictEqual(
			changelogNeedsTranslation(entry({ translations: { de: { content: "x", translatedFrom: { hash } } } }), "de"),
			false,
			"fresh stamp",
		);
		assert.strictEqual(
			changelogNeedsTranslation(
				entry({ translations: { de: { content: "x", translatedFrom: { hash: "0000000000000000" } } } }),
				"de",
			),
			true,
			"stale stamp",
		);
		assert.strictEqual(
			changelogNeedsTranslation(entry({ translations: { de: { content: "manual" } } }), "de"),
			false,
			"an unstamped (manual) overlay is not clobbered",
		);
	});

	it("applyChangelogTranslation overlays per field with English fallback and strips the map", () => {
		const doc = entry({ translations: { de: { content: "DE content" } } });
		const applied = applyChangelogTranslation(doc, "de");
		assert.strictEqual(applied.content, "DE content");
		assert.strictEqual(applied.details, "EN details", "untranslated field falls back to English");
		assert.strictEqual(applied.translations, undefined, "the translations map never leaves the api");
	});

	it("applyChangelogTranslation serves English (and still strips) for en or an untranslated language", () => {
		for (const lang of ["en", "fr"]) {
			const doc = entry({ translations: { de: { content: "DE content" } } });
			const applied = applyChangelogTranslation(doc, lang);
			assert.strictEqual(applied.content, "EN content", lang);
			assert.strictEqual(applied.translations, undefined, lang);
		}
	});
});
