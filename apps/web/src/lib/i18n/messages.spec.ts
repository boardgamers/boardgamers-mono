import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locales, defaultLocale } from "./locales";

/**
 * Message-catalog completeness gate (#306).
 *
 * The paraglide compile (scripts/compile-i18n.mts) falls a missing translation
 * back to the base message, so without this spec a work-in-progress locale
 * would silently render English — or a stale key would linger after the
 * English copy moved on. Instead we require every locale file to carry the
 * EXACT key set of the base locale, with no empty values, and require every
 * messages/<locale>.json file to map to a declared locale (no orphans).
 */

const messagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../messages");

function readMessages(locale: string): Record<string, string> {
	return JSON.parse(readFileSync(path.join(messagesDir, `${locale}.json`), "utf8")) as Record<string, string>;
}

const base = readMessages(defaultLocale);
const baseKeys = Object.keys(base);

describe("i18n message catalogs (#306)", () => {
	it("declares a catalog file for the default locale", () => {
		expect(baseKeys.length).toBeGreaterThan(0);
	});

	for (const locale of locales) {
		describe(`locale "${locale}"`, () => {
			const messages = readMessages(locale);
			const keys = Object.keys(messages);

			it("has exactly the default locale's key set (no missing, no extra)", () => {
				const missing = baseKeys.filter((k) => !(k in messages));
				const extra = keys.filter((k) => !(k in base));
				expect(missing, `missing from ${locale}.json`).toEqual([]);
				expect(extra, `extra in ${locale}.json (not in ${defaultLocale}.json)`).toEqual([]);
			});

			it("has no empty-string values", () => {
				const empty = keys.filter((k) => messages[k].trim() === "");
				expect(empty).toEqual([]);
			});

			it("keeps the same {placeholder} set as the default locale", () => {
				const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
				const mismatched = baseKeys.filter((k) => {
					const expected = placeholders(base[k]);
					const actual = placeholders(messages[k] ?? "");
					return expected.join(",") !== actual.join(",");
				});
				expect(mismatched).toEqual([]);
			});
		});
	}

	it("every messages/*.json file maps to a declared locale (no orphans)", () => {
		const files = readdirSync(messagesDir).filter((f) => f.endsWith(".json"));
		const orphans = files
			.map((f) => f.replace(/\.json$/, ""))
			.filter((name) => !(locales as readonly string[]).includes(name));
		expect(orphans).toEqual([]);
	});

	it("every declared locale has a catalog file", () => {
		const files = new Set(readdirSync(messagesDir).filter((f) => f.endsWith(".json")));
		const missing = locales.filter((locale) => !files.has(`${locale}.json`));
		expect(missing).toEqual([]);
	});
});
