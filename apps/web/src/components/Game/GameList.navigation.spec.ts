// Regression test for the client-navigation pagination bug on
// /boardgame/[boardgameId]/games: navigating from one boardgame to another (same
// route, same component instance, new `boardgameId` prop) left GameList's internal
// $state (`currentPage`, `count`, `games`, `firstRun`) intact. Landing on a non-zero
// page (you paginated the previous game) made *both* $effects fire back to back:
//
//   1. the filter effect (reacts to boardgameId) set `currentPage = 0` and called
//      `load(true)` — fetching games + count for the new game at skip 0;
//   2. the page watcher (reacts to currentPage) saw the reset and fired
//      `load(false)` — fetching games with `fetchCount: false`, so `count` was never
//      updated, leaving the list's total from the *previous* game.
//
// The two loads race; whichever settles last wins `games`, while `count` can come
// from the wrong game (or stay stale). The fix makes a boardgame/filter change
// reset to page 0 *and* perform a single load that re-fetches both games and count,
// dropping the spurious page-watcher load that had `fetchCount: false`.
import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));
vi.mock("@/components/icons/IconClockHistory.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
vi.mock("@/modules/cdk", async () => {
	const actual = await vi.importActual<typeof import("@/modules/cdk")>("@/modules/cdk");
	return {
		...actual,
		Badge: (await import("@/lib/__mocks__/BadgeStub.svelte")).default,
		Pagination: (await import("@/lib/__mocks__/PaginationStub.svelte")).default,
	};
});

import { get } from "@/lib/api";
import { clearGamesCache } from "@/lib/games.svelte";
import GameListHarness, { harBoardgameId } from "./GameListHarness.svelte";

const getMock = vi.mocked(get);
let seq = 0;

function fullGame(_id: string): unknown {
	return {
		_id,
		status: "open",
		players: [],
		currentPlayers: [],
		createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
		game: { name: `game-${++seq}` },
		options: { setup: { nbPlayers: 2 }, timing: { timer: { start: 0, end: 0 } } },
	};
}

function page1Games(prefix: string): unknown[] {
	return Array.from({ length: 10 }, (_, i) => fullGame(`${prefix}-${i}`));
}
function page2Games(prefix: string): unknown[] {
	return Array.from({ length: 2 }, (_, i) => fullGame(`${prefix}-${10 + i}`));
}

// Route the api by boardgame + skip. Each boardgame has `total` open games and a
// map of page-index → games array (so page 0 and page 1 return different IDs).
function mockApi(boardgames: Record<string, { total: number; pages: Record<number, unknown[]> }>) {
	getMock.mockImplementation((url: string, params: unknown) => {
		const p = params as Record<string, unknown>;
		const boardgame = p.boardgame as string;
		const entry = boardgames[boardgame];
		if (!entry) return Promise.resolve([]) as never;
		if (url.endsWith("/count")) return Promise.resolve(entry.total) as never;
		const skip = (p.skip as number) ?? 0;
		const count = (p.count as number) ?? 10;
		const page = Math.floor(skip / count);
		return Promise.resolve(entry.pages[page] ?? []) as never;
	});
}

function gameIds(target: HTMLElement): string[] {
	return [...target.querySelectorAll(".game-name")].map((el) => el.textContent?.trim() ?? "");
}

function countText(target: HTMLElement): string {
	return target.querySelector("h3 span")?.textContent?.replace(/[()]/g, "").trim() ?? "";
}

function mountList(boardgame: string) {
	const target = document.createElement("div");
	document.body.appendChild(target);
	harBoardgameId.set(boardgame); // set the param BEFORE mount, like real `data` props
	const instance = mount(GameListHarness as never, {
		target,
		props: { gameStatus: "open" },
	}) as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

async function settle(target: HTMLElement, expectedIds: string[], expectedCount: string) {
	await vi.waitFor(() => {
		expect(gameIds(target)).toEqual(expectedIds);
		expect(countText(target)).toBe(expectedCount);
	});
}

const POWERGRID = { total: 12, pages: { 0: page1Games("pg"), 1: page2Games("pg") } };
const GAIA = { total: 5, pages: { 0: page1Games("gp").slice(0, 5) } };

describe("GameList boardgameId navigation pagination", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
		harBoardgameId.set(undefined);
		document.body.innerHTML = "";
	});

	it("resets to page 0 with fresh games AND count when navigating to a new boardgame", async () => {
		mockApi({ powergrid: POWERGRID, "gaia-project": GAIA });
		const { target, instance } = mountList("powergrid");
		await settle(
			target,
			Array.from({ length: 10 }, (_, i) => `pg-${i}`),
			"12",
		);

		// Paginate to page 2 (index 1). This drives currentPage = 1.
		const page2 = [...target.querySelectorAll("[aria-label]")].find((el) =>
			el.getAttribute("aria-label")?.includes("Go to page 2"),
		);
		expect(page2, "page 2 control should exist").toBeTruthy();
		page2!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		flushSync();
		await settle(target, ["pg-10", "pg-11"], "12");

		// Navigate to a different boardgame.
		harBoardgameId.set("gaia-project");
		flushSync();
		await settle(
			target,
			Array.from({ length: 5 }, (_, i) => `gp-${i}`),
			"5",
		);

		// No second page for the 5-game gaia-project list.
		expect(
			[...target.querySelectorAll("[aria-label]")].some((el) =>
				el.getAttribute("aria-label")?.includes("Go to page 2"),
			),
		).toBe(false);

		unmount(instance as never);
	});

	it("fetches count for the new boardgame (not stale from the previous one)", async () => {
		mockApi({ powergrid: POWERGRID, "gaia-project": GAIA });
		const { target, instance } = mountList("powergrid");
		await settle(
			target,
			Array.from({ length: 10 }, (_, i) => `pg-${i}`),
			"12",
		);

		// Paginate so the list is on a non-zero page before navigating away.
		const page2 = [...target.querySelectorAll("[aria-label]")].find((el) =>
			el.getAttribute("aria-label")?.includes("Go to page 2"),
		);
		page2!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		flushSync();
		await settle(target, ["pg-10", "pg-11"], "12");

		const gaiaCalls = () =>
			getMock.mock.calls.filter(([, params]) => (params as Record<string, unknown>).boardgame === "gaia-project") as [
				string,
				Record<string, unknown>,
			][];

		const before = getMock.mock.calls.length;
		harBoardgameId.set("gaia-project");
		flushSync();
		await settle(
			target,
			Array.from({ length: 5 }, (_, i) => `gp-${i}`),
			"5",
		);

		// Navigation must perform exactly ONE load for the new boardgame: a single games
		// fetch + a single count fetch (no redundant page-watcher load with fetchCount:false,
		// no self-invalidating re-run of the filter effect).
		const navCalls = gaiaCalls();
		expect(navCalls.filter(([url]) => !url.endsWith("/count"))).toHaveLength(1);
		expect(navCalls.filter(([url]) => url.endsWith("/count"))).toHaveLength(1);
		// And no other (e.g. stale-boardgame) fetches were made during navigation.
		expect(getMock.mock.calls.length - before).toBe(2);

		unmount(instance as never);
	});
});
