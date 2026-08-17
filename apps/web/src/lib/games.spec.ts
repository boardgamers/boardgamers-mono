// Regression test for issue #204: "click logo → refresh game lists" was broken
// because `GameList`'s reaction to `$logoClicks` re-called `loadGames` with the
// same params, and the SvelteMap cache (keyed by params) served the stale entry —
// `refresh=true` only toggled `fetchCount`, never the cache. The `refresh` param
// now skips the cache read AND overwrites the entry, so a user-triggered refresh
// always hits the network and subsequent reads are fresh.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ get: vi.fn() }));

import { get } from "./api";
import { clearGamesCache, loadGames, matchesSetupOptions } from "./games.svelte";
import { LIVE_GAME_MAX_TIME_PER_GAME } from "@/utils";
import type { GameFront } from "@bgs/models";

const getMock = vi.mocked(get);

function mockApi(games: unknown[] = [], total = 0) {
	getMock.mockImplementation((url: string) => Promise.resolve(url.endsWith("/count") ? total : games) as never);
}

function fetchedUrls(): string[] {
	return getMock.mock.calls.map(([url]) => url as string);
}

/** The query object passed to `get` for the games (non-count) fetch. */
function gamesQuery(): Record<string, unknown> {
	const call = getMock.mock.calls.find(([url]) => !(url as string).endsWith("/count"));
	return (call?.[1] ?? {}) as Record<string, unknown>;
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

// #55: the pace filter maps to a timePerGame bound server-side — live games have a
// sub-day clock, async games a day-or-more clock. Lock the boundary (24h) here.
describe("loadGames pace filter (#55)", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
		mockApi([], 0);
	});

	it("pace: live maps to maxDuration just under a day", async () => {
		await loadGames({ gameStatus: "open", pace: "live" });
		expect(gamesQuery().maxDuration).toBe(LIVE_GAME_MAX_TIME_PER_GAME - 1);
		expect(gamesQuery().minDuration).toBeUndefined();
	});

	it("pace: async maps to minDuration of a day", async () => {
		await loadGames({ gameStatus: "open", pace: "async" });
		expect(gamesQuery().minDuration).toBe(LIVE_GAME_MAX_TIME_PER_GAME);
		expect(gamesQuery().maxDuration).toBeUndefined();
	});

	it("no pace sends no duration bound", async () => {
		await loadGames({ gameStatus: "open" });
		expect(gamesQuery().minDuration).toBeUndefined();
		expect(gamesQuery().maxDuration).toBeUndefined();
	});
});

// #55: the boardgame page filters its open games by that game's setup options
// (map / variant / …) client-side — lock the matching semantics here.
describe("matchesSetupOptions (#55)", () => {
	const game = (options: Record<string, unknown>) => ({ game: { options } }) as GameFront;

	it("no filter matches everything", () => {
		expect(matchesSetupOptions(game({ layout: "xshape" }), undefined)).toBe(true);
		expect(matchesSetupOptions(game({}), {})).toBe(true);
	});

	it("a select option requires the exact item", () => {
		expect(matchesSetupOptions(game({ layout: "xshape" }), { layout: "xshape" })).toBe(true);
		expect(matchesSetupOptions(game({ layout: "balanced" }), { layout: "xshape" })).toBe(false);
		// The option wasn't set on the game at all (e.g. default left unset).
		expect(matchesSetupOptions(game({}), { layout: "xshape" })).toBe(false);
	});

	it("a checkbox option requires the flag to be set", () => {
		expect(matchesSetupOptions(game({ auction: true }), { auction: true })).toBe(true);
		expect(matchesSetupOptions(game({}), { auction: true })).toBe(false);
	});

	it("every filtered option must match", () => {
		const g = game({ layout: "xshape", auction: true });
		expect(matchesSetupOptions(g, { layout: "xshape", auction: true })).toBe(true);
		expect(matchesSetupOptions(g, { layout: "balanced", auction: true })).toBe(false);
	});
});
