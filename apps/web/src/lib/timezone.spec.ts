import { describe, expect, it } from "vitest";
import { parseTimezone, timezoneFromCookieHeader } from "./timezone";

// The `tz` cookie is attacker-controllable, so the value is validated twice:
// a loose IANA shape, then Intl itself. Only a zone Intl can actually format
// with ever reaches SSR rendering (#339).
describe("parseTimezone", () => {
	it("accepts real IANA zones", () => {
		expect(parseTimezone("Europe/Paris")).toBe("Europe/Paris");
		expect(parseTimezone("America/New_York")).toBe("America/New_York");
		expect(parseTimezone("UTC")).toBe("UTC");
		expect(parseTimezone("Etc/GMT+5")).toBe("Etc/GMT+5");
	});

	it("rejects zones Intl doesn't know", () => {
		expect(parseTimezone("Middle/Earth")).toBeUndefined();
		expect(parseTimezone("Not/AZone")).toBeUndefined();
	});

	it("rejects malformed values (never throws)", () => {
		expect(parseTimezone("")).toBeUndefined();
		expect(parseTimezone(undefined)).toBeUndefined();
		expect(parseTimezone(null)).toBeUndefined();
		expect(parseTimezone(42)).toBeUndefined();
		expect(parseTimezone("../../etc/passwd")).toBeUndefined();
		expect(parseTimezone("a".repeat(200))).toBeUndefined();
		expect(parseTimezone("<script>alert(1)</script>")).toBeUndefined();
	});
});

describe("timezoneFromCookieHeader", () => {
	it("extracts a plain zone", () => {
		expect(timezoneFromCookieHeader("tz=Europe/Paris")).toBe("Europe/Paris");
	});

	it("extracts a percent-encoded zone among other cookies", () => {
		expect(timezoneFromCookieHeader("sidebarOpen=true; tz=America%2FNew_York; other=x")).toBe("America/New_York");
	});

	it("returns undefined when the cookie is absent", () => {
		expect(timezoneFromCookieHeader("")).toBeUndefined();
		expect(timezoneFromCookieHeader("sidebarOpen=true")).toBeUndefined();
	});

	it("returns undefined for invalid values (never throws)", () => {
		expect(timezoneFromCookieHeader("tz=Not/AZone")).toBeUndefined();
		expect(timezoneFromCookieHeader("tz=%E0%A4%A")).toBeUndefined(); // bad percent-encoding
		expect(timezoneFromCookieHeader("tz=")).toBeUndefined();
	});
});
