import { describe, expect, it } from "vitest";
import { isRestrictedTimerWindow, timerWindow } from "./time";

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
