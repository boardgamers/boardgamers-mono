import { describe, expect, it } from "vitest";
import { countries, filterCountries } from "./countries";

describe("filterCountries", () => {
	it("returns all countries for an empty query", () => {
		expect(filterCountries("")).toEqual(countries);
		expect(filterCountries("   ")).toEqual(countries);
	});

	it("matches on name, case-insensitively", () => {
		expect(filterCountries("japan")).toEqual([{ code: "JP", name: "Japan" }]);
		expect(filterCountries("GERM")).toEqual([{ code: "DE", name: "Germany" }]);
	});

	it("matches any substring of the name", () => {
		expect(filterCountries("france")).toEqual([{ code: "FR", name: "France" }]);
		const results = filterCountries("united");
		expect(results.length).toBeGreaterThan(1);
		expect(results).toContainEqual({ code: "US", name: "United States" });
	});

	it("matches on the ISO code", () => {
		expect(filterCountries("fr")).toContainEqual({ code: "FR", name: "France" });
		expect(filterCountries("jp")).toEqual([{ code: "JP", name: "Japan" }]);
	});

	it("returns an empty list when nothing matches", () => {
		expect(filterCountries("atlantis")).toEqual([]);
	});
});
