// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	applyGameInfoTranslation,
	applyGameOptionTranslations,
	optionKeysNeedingTranslation,
	optionLabelHash,
	optionSourceStrings,
} from "./gameinfo-i18n.ts";

describe("applyGameInfoTranslation (#306)", () => {
	const doc = { description: "EN desc", rules: "EN rules", credits: "EN credits", label: "Game" };
	const translations = { de: { description: "DE desc" } };

	it("passes null through", () => {
		assert.strictEqual(applyGameInfoTranslation(null, translations, "de"), null);
	});

	it("is a no-op for en, missing translations, or an untranslated language", () => {
		for (const [t, lang] of [
			[translations, "en"],
			[undefined, "de"],
			[translations, "fr"],
			[{}, "de"],
		] as const) {
			const target = { ...doc };
			assert.strictEqual(applyGameInfoTranslation(target, t, lang), target, `same reference for ${lang}`);
			assert.deepEqual(target, doc);
		}
	});

	it("overlays only the translated fields", () => {
		const merged = applyGameInfoTranslation({ ...doc }, translations, "de");
		assert.deepEqual(merged, { ...doc, description: "DE desc" });
	});
});

describe("option-label translation helpers (#306 follow-up)", () => {
	const version = {
		options: [
			{ name: "map", label: "Map layout", type: "select" as const, items: [{ name: "random", label: "Random" }] },
			{ name: "secret", label: "Secret knob", type: "hidden" as const, items: [{ name: "x", label: "X" }] },
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately malformed: no stable name → no overlay key → skipped
			{ label: "No name" } as never,
		],
		settings: [{ name: "autoplay", label: "Auto-play", type: "checkbox" as const }],
		preferences: [{ name: "sound", label: "Sound", type: "checkbox" as const }],
		expansions: [{ name: "cities", label: "The Cities" }],
	};

	it("optionSourceStrings keys every visible label by its stable path, skipping hidden options", () => {
		assert.deepEqual(optionSourceStrings(version), {
			"options.map": "Map layout",
			"options.map.items.random": "Random",
			"settings.autoplay": "Auto-play",
			"preferences.sound": "Sound",
			"expansions.cities": "The Cities",
		});
		assert.deepEqual(optionSourceStrings(null), {});
		assert.deepEqual(optionSourceStrings({}), {});
	});

	it("optionKeysNeedingTranslation flags missing, stale, and stamp-less entries per string", () => {
		const source = optionSourceStrings(version);
		// Empty overlay: everything needs work.
		assert.deepEqual(optionKeysNeedingTranslation(source, undefined).sort(), Object.keys(source).sort());
		const overlay = {
			"options.map": { label: "Disposition", translatedFrom: { hash: optionLabelHash("Map layout") } }, // fresh
			"options.map.items.random": { label: "Aléatoire", translatedFrom: { hash: optionLabelHash("old label") } }, // stale
			"settings.autoplay": { label: "Auto" }, // stamp-less → unverifiable
		};
		assert.deepEqual(optionKeysNeedingTranslation(source, overlay).sort(), [
			"expansions.cities",
			"options.map.items.random",
			"preferences.sound",
			"settings.autoplay",
		]);
	});

	it("applyGameOptionTranslations resolves labels per string with English fallback, without mutating the source arrays", () => {
		const merged = { ...version, options: [...version.options] };
		const applied = applyGameOptionTranslations(
			merged,
			{
				fr: {
					"options.map": { label: "Disposition de la carte" },
					"options.map.items.random": { label: "Aléatoire" },
					"expansions.cities": { label: "Les Cités" },
					"options.renamed-away": { label: "Fantôme" }, // no matching option → ignored
				},
			},
			"fr",
		);
		assert.strictEqual(applied.options[0].label, "Disposition de la carte");
		assert.strictEqual(applied.options[0].items?.[0].label, "Aléatoire");
		assert.strictEqual(applied.settings[0].label, "Auto-play", "untranslated string falls back to English");
		assert.strictEqual(applied.expansions[0].label, "Les Cités");
		// The underlying option objects are not mutated (they may be shared with the raw version doc).
		assert.strictEqual(version.options[0].label, "Map layout");
		assert.strictEqual(version.options[0].items?.[0].label, "Random");
	});

	it("applyGameOptionTranslations is a no-op for en, a missing overlay, or an untranslated language", () => {
		const doc = { options: version.options };
		assert.strictEqual(applyGameOptionTranslations(doc, { fr: {} }, "en"), doc);
		assert.strictEqual(applyGameOptionTranslations(doc, undefined, "fr"), doc);
		assert.strictEqual(applyGameOptionTranslations(null, { fr: {} }, "fr"), null);
		const untouched = applyGameOptionTranslations(doc, { de: {} }, "fr");
		assert.strictEqual(untouched.options[0].label, "Map layout");
	});
});
