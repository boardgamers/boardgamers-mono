// Regression test for issue #204: "click logo → refresh game lists" was broken
// because `GameList`'s reaction to `$logoClicks` re-called `loadGames` with the
// same params, and the SvelteMap cache (keyed by params) served the stale entry —
// `refresh=true` only toggled `fetchCount`, never the cache. The `refresh` param
// now skips the cache read AND overwrites the entry, so a user-triggered refresh
// always hits the network and subsequent reads are fresh.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ get: vi.fn() }));

import { get } from "./api";
import { clearGamesCache, loadGames } from "./games.svelte";

const getMock = vi.mocked(get);

function mockApi(games: unknown[] = [], total = 0) {
	getMock.mockImplementation((url: string) => Promise.resolve(url.endsWith("/count") ? total : games) as never);
}

function fetchedUrls(): string[] {
	return getMock.mock.calls.map(([url]) => url as string);
}

describe("loadGames cache", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
		mockApi([{ _id: "g1" }], 1);
	});

	it("serves the cached result on a repeat call (no second fetch)", async () => {
		// `store: true` mirrors how the +page.ts loads seed the cache that GameList reads.
		const first = await loadGames({ gameStatus: "active", store: true });
		const second = await loadGames({ gameStatus: "active" });

		expect(first).toEqual({ games: [{ _id: "g1" }], total: 1 });
		expect(second).toEqual(first);
		expect(getMock).toHaveBeenCalledTimes(2); // games + count, once — no second fetch
	});

	it("refresh: true bypasses the cache and refetches", async () => {
		await loadGames({ gameStatus: "active" });
		expect(getMock).toHaveBeenCalledTimes(2);

		mockApi([{ _id: "g2" }], 2);
		const refreshed = await loadGames({ gameStatus: "active", refresh: true });

		expect(getMock).toHaveBeenCalledTimes(4); // full second round trip
		expect(fetchedUrls()).toContain("/game/status/active/count");
		expect(refreshed).toEqual({ games: [{ _id: "g2" }], total: 2 });
	});

	it("refresh: true overwrites the cache entry, so later reads are fresh", async () => {
		await loadGames({ gameStatus: "active" });
		mockApi([{ _id: "g2" }], 2);
		await loadGames({ gameStatus: "active", refresh: true });

		const calls = getMock.mock.calls.length;
		const after = await loadGames({ gameStatus: "active" });

		expect(getMock).toHaveBeenCalledTimes(calls); // no new fetch — but the data is the refreshed one
		expect(after).toEqual({ games: [{ _id: "g2" }], total: 2 });
	});

	it("refresh works with fetchCount: false (single fetch, still cached for later)", async () => {
		const result = await loadGames({ gameStatus: "open", fetchCount: false, refresh: true });

		expect(getMock).toHaveBeenCalledTimes(1);
		expect(fetchedUrls()).toEqual(["/game/status/open"]);

		// Stored despite the default `store: false`: a later identical call hits the cache.
		const again = await loadGames({ gameStatus: "open", fetchCount: false });
		expect(getMock).toHaveBeenCalledTimes(1);
		expect(again).toEqual(result);
	});

	it("clearGamesCache forces the next call to refetch", async () => {
		await loadGames({ gameStatus: "active" });
		clearGamesCache();
		await loadGames({ gameStatus: "active" });

		expect(getMock).toHaveBeenCalledTimes(4);
	});
});
