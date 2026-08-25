import { describe, expect, it } from "vitest";
import { parsePreferredLanguage, parsePreferredLanguageTag } from "./accept-language";

describe("parsePreferredLanguage", () => {
	it("returns null for a missing/empty header", () => {
		expect(parsePreferredLanguage(null)).toBeNull();
		expect(parsePreferredLanguage(undefined)).toBeNull();
		expect(parsePreferredLanguage("")).toBeNull();
		expect(parsePreferredLanguage("   ")).toBeNull();
	});

	it("extracts the base subtag of the first (most-preferred) entry", () => {
		expect(parsePreferredLanguage("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
		expect(parsePreferredLanguage("en-US,en;q=0.9")).toBe("en");
		expect(parsePreferredLanguage("de")).toBe("de");
	});

	it("lowercases and trims", () => {
		expect(parsePreferredLanguage("FR-fr")).toBe("fr");
		expect(parsePreferredLanguage("  EN-US ; q=0.9")).toBe("en");
	});

	it("keeps only the base subtag of multi-part tags", () => {
		expect(parsePreferredLanguage("zh-Hant-TW")).toBe("zh");
		expect(parsePreferredLanguage("pt-BR")).toBe("pt");
	});

	it("ignores the q-value — the first entry wins regardless", () => {
		// Browsers order by preference; even an explicit lower q on the first entry
		// means it was listed first, so we trust the order over parsing q.
		expect(parsePreferredLanguage("fr;q=0.5,en;q=0.9")).toBe("fr");
	});

	it("returns null for a wildcard", () => {
		expect(parsePreferredLanguage("*")).toBeNull();
		expect(parsePreferredLanguage("*;q=0.5")).toBeNull();
	});

	it("returns null for malformed entries", () => {
		expect(parsePreferredLanguage("123")).toBeNull();
		expect(parsePreferredLanguage("e")).toBeNull();
		expect(parsePreferredLanguage("english-US")).toBeNull();
		expect(parsePreferredLanguage("!!")).toBeNull();
	});

	it("accepts 3-letter ISO 639 codes", () => {
		expect(parsePreferredLanguage("haw-US")).toBe("haw");
	});
});

describe("parsePreferredLanguageTag", () => {
	it("keeps the region subtag of regionally-localized languages only", () => {
		expect(parsePreferredLanguageTag("pt-BR,pt;q=0.9")).toBe("pt-br");
		expect(parsePreferredLanguageTag("fr-FR,fr;q=0.9")).toBe("fr");
		expect(parsePreferredLanguageTag("zh-Hant-TW")).toBe("zh");
	});

	it("handles missing, wildcard and malformed headers like parsePreferredLanguage", () => {
		expect(parsePreferredLanguageTag(null)).toBeNull();
		expect(parsePreferredLanguageTag("*")).toBeNull();
		expect(parsePreferredLanguageTag("123")).toBeNull();
		expect(parsePreferredLanguageTag("english-US")).toBeNull();
	});
});
