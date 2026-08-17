// Regression tests for issues #204 and #236:
// - #204: bumping `logoClicks` (the "BGS" logo, the active game in the sidebar,
//   an avatar save) must make GameList refetch with a cache bypass — before the
//   fix, the effect re-ran `load(true)` but the games cache served the stale
//   entry and the list never updated. A filter change, in contrast, keeps using
//   the cache.
// - #236: the relative-time labels ("created X ago", "last activity X ago",
//   "⏱ Xh left") were computed against a `now` frozen at component init, so a
//   refresh couldn't move them — a (re)load must refresh `now` and recompute
//   the labels. All three labels now read the reactive `now`; the test exercises
//   the active branch's lastActivity/turnTimeLeft, which read `now` even before the
//   fix (the open row's "created X ago" read Date.now() live then, so it couldn't
//   show the freeze).
//
// The #204 lists use gameStatus "open" (the "active" branch renders a `Badge`,
// which crashes in this jsdom/svelte mount environment); the #236 test uses
// "active" and stubs Badge instead. The open/active code paths share the same
// loadGames + $logoClicks handling, so behavior coverage is identical.
import { flushSync, mount, unmount } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));
// The real icon crashes when mounted with empty props in this jsdom env (see the
// stub's comment); it isn't what this spec exercises.
vi.mock("@/components/icons/IconClockHistory.svelte", async () => ({
	default: (await import("@/lib/__mocks__/IconStub.svelte")).default,
}));
// Badge (rendered on the "active" branch) also crashes on its `{...rest}` spread in
// jsdom; stub it so the #236 test can mount an active list. Pagination/Loading are
// kept real.
vi.mock("@/modules/cdk", async () => {
	const actual = await vi.importActual<typeof import("@/modules/cdk")>("@/modules/cdk");
	return { ...actual, Badge: (await import("@/lib/__mocks__/BadgeStub.svelte")).default };
});

import { get } from "@/lib/api";
import { clearGamesCache, loadGames } from "@/lib/games.svelte";
import { logoClick } from "@/lib/stores.svelte";
import { gameInfoKey, type GameInfoMap } from "@/lib/game-info.svelte";
import GameList from "./GameList.svelte";
import GameListHarness from "./GameListHarness.svelte";

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

// Settle the loadGames promise chain + Svelte's reactive flush without touching the
// (fake) clock — a vi.waitFor poll would auto-advance fake timers and mask the
// frozen-`now` bug under test. The chain is promise-only (no timers), so a handful of
// microtask turns + a final flushSync() is deterministic.
async function flushMicrotasks() {
	for (let i = 0; i < 10; i++) {
		await Promise.resolve();
	}
	flushSync();
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

	it("a reload refreshes the relative-time labels (#236)", async () => {
		// The "ago"/"left" labels read `now`, which used to be a constant captured at
		// component init — so a reload re-rendered but the labels stayed frozen. This
		// test uses an active game because lastActivity and turnTimeLeft read `now` even
		// before the fix (the open row's "created X ago" read Date.now() live then, so it
		// couldn't show the freeze). Fake timers pin the clock; time only moves via
		// explicit setSystemTime (a vi.waitFor poll would auto-advance it and mask the
		// frozen-`now` bug).
		const T0 = 1_800_000_000_000;
		vi.useFakeTimers({ now: T0 });
		try {
			const game = {
				_id: "g-active",
				status: "active",
				players: [{ _id: "u1" }, { _id: "u2" }],
				currentPlayers: [{ _id: "u1", deadline: new Date(T0 + 2 * 3600 * 1000).toISOString() }],
				lastMove: new Date(T0 - 10 * 60 * 1000).toISOString(),
				createdAt: new Date(T0 - 60 * 60 * 1000).toISOString(),
				game: { name: "g-active-game" },
				options: {
					setup: { nbPlayers: 2 },
					timing: { timer: { start: 0, end: 0 }, timePerGame: 86400, timePerMove: 3600 },
				},
			} as never;
			mockApi([game], 1);

			const target = document.createElement("div");
			document.body.appendChild(target);
			const instance = mount(GameList as never, { target, props: { gameStatus: "active", userId: "u1" } });
			flushSync();
			await flushMicrotasks();
			const row = () => target.querySelector(".game-item")?.textContent?.replace(/\s+/g, " ") ?? "";
			expect(row()).toContain("10 minutes ago");
			expect(row()).toContain("2h left");

			// Time passes; lastMove/deadline don't move. A logo-click refresh must
			// recompute the labels against the new time (before the fix they stayed frozen).
			vi.setSystemTime(T0 + 60 * 60 * 1000);
			logoClick();
			flushSync();
			await flushMicrotasks();
			expect(row()).toContain("1h 10m ago");
			expect(row()).toContain("1h left");

			unmount(instance as never);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("GameList last move (#208)", () => {
	const T0 = 1_800_000_000_000;

	function activeGame(lastMoveInfo: unknown) {
		return {
			_id: `g-lm-${++seq}`,
			status: "active",
			players: [{ _id: "u1" }, { _id: "u2", name: "terrans" }],
			currentPlayers: [{ _id: "u1" }],
			lastMove: new Date(T0 - 10 * 60 * 1000).toISOString(),
			createdAt: new Date(T0 - 60 * 60 * 1000).toISOString(),
			game: { name: `game-lm-${seq}` },
			options: { setup: { nbPlayers: 2 }, timing: { timer: { start: 0, end: 0 } } },
			lastMoveInfo,
		} as never;
	}

	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
		document.body.innerHTML = "";
	});

	it("shows the last move for ongoing games, and skips it when missing or object-shaped", async () => {
		mockApi(
			[
				activeGame({
					player: "u2",
					move: "terrans build m 1x0",
					at: new Date(T0 - 10 * 60 * 1000).toISOString(),
					moveNumber: 12,
				}),
				activeGame({
					player: "u2",
					move: '{"name":"Bid","data":15}',
					at: new Date(T0 - 9 * 60 * 1000).toISOString(),
					moveNumber: 3,
				}),
				activeGame(null),
			],
			3,
		);
		const { target, instance } = mountList({ gameStatus: "active", userId: "u1" });
		await flushMicrotasks();

		const chips = [...target.querySelectorAll(".last-move")];
		expect(chips.length).toBe(1);
		const chipText = chips[0].textContent?.replace(/\s+/g, " ") ?? "";
		expect(chipText).toContain("terrans build m 1x0");
		expect(chipText).not.toContain("by");
		// The mover's name is only in the tooltip, not the visible text.
		expect(chips[0].getAttribute("title")).toBe("terrans: terrans build m 1x0");

		unmount(instance as never);
	});
});

// #55: open rows badge the creator's setup options + join restrictions (min karma,
// elo range) so players see what they're joining at a glance.
describe("GameList open-row setup badges (#55)", () => {
	const GAME_NAME = "game-badges";

	function openGame(_id: string, gameOptions: Record<string, unknown> = {}, meta?: Record<string, unknown>) {
		return {
			_id,
			status: "open",
			players: [],
			currentPlayers: [],
			createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
			game: { name: GAME_NAME, version: 1, options: gameOptions },
			options: { setup: { nbPlayers: 2 }, timing: { timer: { start: 0, end: 0 } }, meta },
		} as never;
	}

	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
		document.body.innerHTML = "";
	});

	it("badges the chosen setup options and the karma/elo join restrictions", async () => {
		mockApi(
			[
				openGame(
					"g-badges",
					{ layout: "xshape", auction: true },
					{ minimumKarma: 30, eloRange: { min: 100, max: 300 } },
				),
				openGame("g-plain"),
			],
			2,
		);
		// The game-info list context normally comes from the root layout; the harness
		// provides it during component init (setContext can't run after mount).
		const gameInfos = {
			[gameInfoKey(GAME_NAME, 1)]: {
				_id: { game: GAME_NAME, version: 1 },
				options: [
					{
						name: "layout",
						label: "Map layout",
						type: "select",
						items: [
							{ name: "standard", label: "Standard" },
							{ name: "xshape", label: "X shape" },
						],
					},
					{ name: "auction", label: "[Auction](/page/game-badges/auction) mode", type: "checkbox" },
				],
			},
		} as unknown as GameInfoMap;
		const target = document.createElement("div");
		document.body.appendChild(target);
		const instance = mount(GameListHarness as never, { target, props: { gameStatus: "open", gameInfos } });
		flushSync();
		await waitForGames(target, ["g-badges", "g-plain"]);

		const rows = [...target.querySelectorAll(".game-item")];
		const badged = rows.find((row) => row.textContent?.includes("g-badges"))!;
		const badges = [...badged.querySelectorAll(".setup-badge")].map((el) =>
			el.textContent?.replace(/\s+/g, " ").trim(),
		);
		expect(badges).toEqual(["Map layout: X shape", "Auction mode", "☯️ 30+ karma", "📈 100–300 elo"]);

		// The row is itself an `<a>`; the badge's markdown links must be flattened to
		// text — a nested `<a>` is invalid HTML and breaks hydration (layout shift).
		expect(badged.querySelectorAll(".setup-badge a").length).toBe(0);

		// No options/restrictions → no badge row at all.
		const plain = rows.find((row) => row.textContent?.includes("g-plain"))!;
		expect(plain.querySelectorAll(".setup-badge").length).toBe(0);

		unmount(instance as never);
	});
});
