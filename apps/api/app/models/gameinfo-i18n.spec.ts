// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyGameInfoTranslation } from "./gameinfo-i18n.ts";

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
