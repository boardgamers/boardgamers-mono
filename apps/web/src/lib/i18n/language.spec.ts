import { describe, expect, it } from "vitest";
import { parseLanguageTag, resolveLanguage } from "./language";

describe("parseLanguageTag", () => {
	it("accepts exact locale codes", () => {
		expect(parseLanguageTag("en")).toBe("en");
		expect(parseLanguageTag("pt-BR")).toBe("pt-BR");
	});

	it("is case-insensitive (BCP-47 tags)", () => {
		expect(parseLanguageTag("pt-br")).toBe("pt-BR");
		expect(parseLanguageTag("PT-BR")).toBe("pt-BR");
	});

	it("strips the region subtag of non-regional locales", () => {
		expect(parseLanguageTag("de-AT")).toBe("de");
		expect(parseLanguageTag("fr-ca")).toBe("fr");
	});

	it("falls a bare base subtag back to its regional default", () => {
		expect(parseLanguageTag("pt")).toBe("pt-BR");
	});

	it("rejects unsupported and malformed values", () => {
		expect(parseLanguageTag("es")).toBeUndefined();
		expect(parseLanguageTag("zh")).toBeUndefined();
		expect(parseLanguageTag("<script>")).toBeUndefined();
		expect(parseLanguageTag(undefined)).toBeUndefined();
		expect(parseLanguageTag(42)).toBeUndefined();
	});
});

describe("resolveLanguage", () => {
	it("resolves Accept-Language tags, including the regional locale", () => {
		expect(resolveLanguage({ acceptLanguageHeader: "pt-BR,pt;q=0.9" })).toBe("pt-BR");
		expect(resolveLanguage({ acceptLanguageHeader: "pt" })).toBe("pt-BR");
		expect(resolveLanguage({ acceptLanguageHeader: "ru-RU,ru;q=0.9" })).toBe("ru");
		expect(resolveLanguage({ acceptLanguageHeader: "de-AT,de;q=0.9" })).toBe("de");
	});

	it("prefers the cookie over Accept-Language", () => {
		expect(resolveLanguage({ cookieHeader: "lang=da", acceptLanguageHeader: "pt-BR" })).toBe("da");
	});

	it("resolves regional tags from the cookie and the user preference", () => {
		expect(resolveLanguage({ cookieHeader: "lang=pt" })).toBe("pt-BR");
		expect(resolveLanguage({ userPreference: "pt-br" })).toBe("pt-BR");
	});

	it("prefers the user preference over the cookie", () => {
		expect(resolveLanguage({ userPreference: "hi", cookieHeader: "lang=da" })).toBe("hi");
	});

	it("falls back to the default locale", () => {
		expect(resolveLanguage({})).toBe("en");
		expect(resolveLanguage({ acceptLanguageHeader: "es-ES" })).toBe("en");
	});
});
