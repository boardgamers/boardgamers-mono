import { describe, expect, it } from "vitest";
import { isRestrictedTimerWindow, timerTimeInTz, timerWindow, timerWindowInTz } from "./time";

// A game's daily clock window (timer.start–timer.end, UTC seconds-since-midnight)
// is only worth surfacing when it's a real overnight restriction. "Always" is
// stored two ways: start === end (the app's sentinel) or the API's near-full-day
// default { start: 0, end: 86399 }. timerWindow renders a restricted window in the
// viewer's own timezone (via timerTime), which is what lets a player tell whether
// the game's active hours match their waking hours.
describe("isRestrictedTimerWindow", () => {
	it("treats start === end as always-on (not restricted)", () => {
		expect(isRestrictedTimerWindow({ start: 0, end: 0 })).toBe(false);
		expect(isRestrictedTimerWindow({ start: 9 * 3600, end: 9 * 3600 })).toBe(false);
	});

	it("treats the API's near-full-day default { 0, 86399 } as always-on", () => {
		expect(isRestrictedTimerWindow({ start: 0, end: 86399 })).toBe(false);
	});

	it("treats a missing timer as always-on", () => {
		expect(isRestrictedTimerWindow(undefined)).toBe(false);
	});

	it("treats a genuine overnight window as restricted", () => {
		expect(isRestrictedTimerWindow({ start: 9 * 3600, end: 22 * 3600 })).toBe(true);
		// Wrap-around window (e.g. 22h–2h) is also a restriction.
		expect(isRestrictedTimerWindow({ start: 22 * 3600, end: 2 * 3600 })).toBe(true);
	});
});

describe("timerWindow", () => {
	it("returns '24h' for always-on clocks (sentinel and API default)", () => {
		expect(timerWindow({ start: 0, end: 0 })).toBe("24h");
		expect(timerWindow({ start: 0, end: 86399 })).toBe("24h");
		expect(timerWindow(undefined)).toBe("24h");
	});

	it("renders a restricted window as a start–end range (converted to local time)", () => {
		// The exact hours depend on the test runner's timezone (timerTime converts
		// UTC→local), but a restricted window must always render as a range, never "24h".
		const w = timerWindow({ start: 9 * 3600, end: 22 * 3600 });
		expect(w).toMatch(/^\d{2}h(\d{2})?–\d{2}h(\d{2})?$/);
		expect(w).not.toBe("24h");
	});
});

// timerTimeInTz / timerWindowInTz take the timezone explicitly (from the `tz`
// cookie on the server, the browser's zone on the client) so SSR and hydration
// render identical clock windows (#339) — these don't depend on the runner's TZ.
describe("timerTimeInTz", () => {
	it("converts UTC seconds-since-midnight to the zone's wall clock", () => {
		// 12:00 UTC = 07:00 in New York (UTC-5, winter) = 15:00 in Nairobi (UTC+3).
		expect(timerTimeInTz(12 * 3600, "America/New_York")).toBe("07h");
		expect(timerTimeInTz(12 * 3600, "Africa/Nairobi")).toBe("15h");
	});

	it("omits zero minutes, keeps non-zero ones", () => {
		expect(timerTimeInTz(9 * 3600, "UTC")).toBe("09h");
		expect(timerTimeInTz(9 * 3600 + 30 * 60, "UTC")).toBe("09h30");
	});

	it("never renders 24h (midnight is 00h)", () => {
		expect(timerTimeInTz(0, "UTC")).toBe("00h");
	});
});

describe("timerWindowInTz", () => {
	it("returns '24h' for always-on clocks", () => {
		expect(timerWindowInTz({ start: 0, end: 0 }, "America/New_York")).toBe("24h");
		expect(timerWindowInTz(undefined, "America/New_York")).toBe("24h");
	});

	it("renders a restricted window in the given zone", () => {
		// 09:00–22:00 UTC = 04:00–17:00 in New York (UTC-5, winter).
		expect(timerWindowInTz({ start: 9 * 3600, end: 22 * 3600 }, "America/New_York")).toBe("04h–17h");
	});
});
