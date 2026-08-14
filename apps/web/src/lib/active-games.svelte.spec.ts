// @vitest-environment jsdom
import { get as getStore } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `activeGames` is a client-only store (throws when `browser` is false); the global
// setup mocks `$app/environment` with browser=false unless SANITIZE_TEST_BROWSER=1.
vi.mock("$app/environment", async (importOriginal) => ({ ...(await importOriginal<object>()), browser: true }));

import { handleCurrentTurnGames } from "./active-games.svelte";
import { activeGames } from "./stores.svelte";

describe("handleCurrentTurnGames", () => {
	beforeEach(() => {
		activeGames.set([]);
	});

	it("sets the store on first list and on change", () => {
		handleCurrentTurnGames(["a", "b"]);
		expect(getStore(activeGames)).toEqual(["a", "b"]);

		handleCurrentTurnGames(["a"]);
		expect(getStore(activeGames)).toEqual(["a"]);
	});

	it("keeps the same reference when the id list is unchanged", () => {
		handleCurrentTurnGames(["a", "b"]);
		const before = getStore(activeGames);

		handleCurrentTurnGames(["a", "b"]);
		expect(getStore(activeGames)).toBe(before);

		// A genuinely different list replaces the reference.
		handleCurrentTurnGames(["b", "a"]);
		expect(getStore(activeGames)).not.toBe(before);
	});

	it("handles the empty list", () => {
		const before = getStore(activeGames);
		handleCurrentTurnGames([]);
		expect(getStore(activeGames)).toBe(before);
	});
});
