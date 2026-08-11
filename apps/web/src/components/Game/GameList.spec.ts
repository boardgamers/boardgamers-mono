// Regression test for issue #204: bumping `logoClicks` (the "BGS" logo, the
// active game in the sidebar, an avatar save) must make GameList refetch with a
// cache bypass — before the fix, the effect re-ran `load(true)` but the games
// cache served the stale entry and the list never updated. A filter change, in
// contrast, keeps using the cache.
//
// The lists use gameStatus "open" because the "active" branch renders a `Badge`,
// which crashes in this jsdom/svelte mount environment (a test-env limitation,
// unrelated to the cache logic under test). The open/active code paths share the
// same loadGames + $logoClicks handling, so behavior coverage is identical.
import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));
// The real icon crashes when mounted with empty props in this jsdom env (see the
// stub's comment); it isn't what this spec exercises.
vi.mock("@/components/icons/IconClockHistory.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));

import { get } from "@/lib/api";
import { clearGamesCache, loadGames } from "@/lib/games.svelte";
import { logoClick } from "@/lib/stores.svelte";
import GameList from "./GameList.svelte";

const getMock = vi.mocked(get);
let seq = 0;

// Minimal GameFront shape the component's "open" rendering touches. A unique
// game name per fixture keeps Svelte's keyed updates from conflating rows.
function fakeGame(_id: string) {
	return {
		_id,
		status: "open",
		players: [],
		currentPlayers: [],
		createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
		game: { name: `game-${++seq}` },
		options: { setup: { nbPlayers: 2 }, timing: { timer: { start: 0, end: 0 } } },
	} as never;
}

function mockApi(games: unknown[] = [], total = 0) {
	getMock.mockImplementation((url: string) => Promise.resolve(url.endsWith("/count") ? total : games) as never);
}

function gameIds(target: HTMLElement): string[] {
	return [...target.querySelectorAll(".game-name")].map((el) => el.textContent?.trim() ?? "");
}

async function waitForGames(target: HTMLElement, ids: string[]) {
	await vi.waitFor(() => expect(gameIds(target)).toEqual(ids));
}

function mountList(props: Record<string, unknown> = {}) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	const instance = mount(GameList as never, {
		target,
		props: { gameStatus: "open", ...props },
	}) as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

describe("GameList refresh on $logoClicks (#204)", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
		mockApi([fakeGame("g-old")], 1);
		document.body.innerHTML = "";
	});

	it("a logo-click bump refetches the list (cache bypassed)", async () => {
		// The real #204 scenario: the / load function pre-seeds the cache with
		// `store: true`, GameList renders it, then a logo click must fetch fresh data
		// instead of re-rendering the stale entry.
		mockApi([fakeGame("g-stale")], 1);
		await loadGames({ gameStatus: "open", count: 10, skip: 0, store: true }); // the +page.ts seed
		const seedCalls = getMock.mock.calls.length;

		const { target, instance } = mountList();
		await waitForGames(target, ["g-stale"]); // rendered from the seeded cache, no fetch
		expect(getMock.mock.calls.length).toBe(seedCalls);

		mockApi([fakeGame("g-new")], 1); // server data changed
		logoClick();
		flushSync();
		await waitForGames(target, ["g-new"]);

		// games + count: a real network round trip, not the stale cache.
		expect(getMock.mock.calls.length).toBe(seedCalls + 2);
		await Promise.resolve(); // let the refresh settle fully before unmount
		unmount(instance as never);
	});

	it("a filter change re-renders a seeded cache entry without refetching", async () => {
		// The / load function seeds the cache with `store: true`. Remounting a GameList
		// for the same filter (what a filter change / navigation back triggers) must
		// read that entry from the cache — no refetch — so lists stay instant.
		mockApi([fakeGame("g-seeded")], 1);
		await loadGames({ gameStatus: "open", count: 10, skip: 0, store: true }); // +page.ts seed
		const calls = getMock.mock.calls.length;

		mockApi([fakeGame("should-not-be-fetched")], 1); // even if the server changed
		const { target, instance } = mountList();
		flushSync();
		await Promise.resolve();
		expect(gameIds(target)).toEqual(["g-seeded"]); // cached data, instantly
		expect(getMock.mock.calls.length).toBe(calls); // no new fetch
		unmount(instance as never);
	});

	it("the logo refresh overwrites the cache, so later reads are fresh", async () => {
		mockApi([fakeGame("g-stale")], 1);
		const first = mountList({ userId: "u1" });
		await waitForGames(first.target, ["g-stale"]);

		// Server data changes; the logo click refreshes the list AND the cache entry.
		mockApi([fakeGame("g-fresh")], 1);
		logoClick();
		flushSync();
		await waitForGames(first.target, ["g-fresh"]);
		await Promise.resolve(); // let the refresh settle fully before unmount
		unmount(first.instance as never);

		// A brand-new GameList for the same filter reads the refreshed cache entry —
		// no network, fresh data.
		mockApi([fakeGame("should-not-be-fetched")], 1);
		const calls = getMock.mock.calls.length;
		const second = mountList({ userId: "u1" });
		flushSync();
		await Promise.resolve();
		expect(gameIds(second.target)).toEqual(["g-fresh"]);
		expect(getMock.mock.calls.length).toBe(calls);
		unmount(second.instance as never);
	});

	it("initial load fetches once (games + count), no double load", async () => {
		const before = getMock.mock.calls.length;
		const { target, instance } = mountList();
		await waitForGames(target, ["g-old"]);
		expect(getMock.mock.calls.length).toBe(before + 2);
		unmount(instance as never);
	});
});
