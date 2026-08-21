// Regression test for the home-page Lobby SSR break: the load seeds the games cache
// (`store: true`) and the GameLists in +page.svelte read it synchronously during init —
// SSR only renders a list when the seeded key matches the component's request key
// exactly. #332 changed the component's fetchCount for sample lists without updating
// this prefetch, the keys diverged, and the Lobby rendered "No games to show" in the
// SSR HTML. Both sides now build params through gameListParams; these tests assert the
// seeded entries are synchronous cache hits for the component's requests.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ get: vi.fn() }));

import { get } from "@/lib/api";
import { clearGamesCache, gameListParams, loadGames, peekGames, type LoadGamesResult } from "@/lib/games.svelte";
import { hasPaceChoice } from "@/components/Game/SetupOptionsFilter.svelte";
import { page } from "$app/state";
import type { GameFront } from "@bgs/models";
import { load } from "./+page";
import type { PageLoad } from "./$types";

const getMock = vi.mocked(get);

function mockApi() {
	getMock.mockImplementation((url: string) => {
		if (url.endsWith("/count")) {
			return Promise.resolve(12) as never;
		}
		if (url === "/site/announcement") {
			return Promise.resolve({ content: "" }) as never;
		}
		return Promise.resolve([{ _id: "g1" }]) as never;
	});
}

function runLoad({ user = null as null | { _id: string }, activeGames = [] as string[] } = {}) {
	return load({
		parent: () => Promise.resolve({ user, activeGames }),
	} as unknown as Parameters<PageLoad>[0]);
}

// A synchronous return (not a promise) is what lets GameList render the list in the
// SSR HTML; a promise means a cache miss and an empty list server-side.
function cachedResult(params: Parameters<typeof gameListParams>[0]): LoadGamesResult {
	const result = loadGames(gameListParams(params));
	expect(result).not.toBeInstanceOf(Promise);
	return result as LoadGamesResult;
}

describe("home page load — games cache seeding for SSR", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
		mockApi();
	});

	it("seeds the sampled open lobby under the key the Lobby GameList requests", async () => {
		await runLoad();

		const lobby = cachedResult({ gameStatus: "open", sample: true, perPage: 5 });
		expect(lobby.games).toEqual([{ _id: "g1" }]);
		expect(lobby.total).toBe(12); // the count powers the "N more open games" footer
	});

	it("seeds the featured list for anonymous visitors and users without active games", async () => {
		await runLoad();

		const featured = cachedResult({ gameStatus: "active", topRecords: true, perPage: 5 });
		expect(featured.games).toEqual([{ _id: "g1" }]);
	});

	it('seeds "My games" when the viewer has active games', async () => {
		await runLoad({ user: { _id: "u1" }, activeGames: ["g1"] });

		const mine = cachedResult({ gameStatus: "active", userId: "u1", perPage: 5 });
		expect(mine.games).toEqual([{ _id: "g1" }]);
	});
});

// Regression for the SSR/hydration pace-chip mismatch (#346): the lobby's games must
// be readable synchronously from the seeded cache (what the +page.svelte lobbyGames
// initializer does) so the server render and the hydration derive the same filter
// visibility. With an all-one-pace lobby the chips must be hidden in BOTH — before the
// fix the parent initialized `lobbyGames` to [] (child bind-back hasn't run during SSR),
// hasPaceChoice([]) is true, so SSR showed chips the hydrated DOM then removed.
describe("home lobby — SSR/hydration pace-filter agreement (#346)", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
	});

	const allLive: GameFront[] = [
		{ _id: "g-live-1", options: { timing: { timePerGame: 3600 } } },
		{ _id: "g-live-2", options: { timing: { timePerGame: 7200 } } },
	] as unknown as GameFront[];

	function seededLobbyGames() {
		// The exact expression +page.svelte uses to initialize lobbyGames.
		return peekGames(gameListParams({ gameStatus: "open", sample: true, perPage: 5 }))?.games ?? [];
	}

	it("all-one-pace lobby: the seeded games are synchronously readable and hide the pace filter", async () => {
		getMock.mockImplementation(
			(url: string) =>
				Promise.resolve(
					url.endsWith("/count") ? allLive.length : url === "/site/announcement" ? { content: "" } : allLive,
				) as never,
		);
		await runLoad();

		const games = seededLobbyGames();
		expect(games.map((g) => g._id)).toEqual(["g-live-1", "g-live-2"]);
		// SSR and hydration agree: one pace → no pace filter.
		expect(hasPaceChoice(games)).toBe(false);
	});

	it("mixed-pace lobby: the seeded games show the pace filter (SSR == hydrated)", async () => {
		const mixed = [
			...allLive,
			{ _id: "g-async", options: { timing: { timePerGame: 172800 } } },
		] as unknown as GameFront[];
		getMock.mockImplementation(
			(url: string) =>
				Promise.resolve(
					url.endsWith("/count") ? mixed.length : url === "/site/announcement" ? { content: "" } : mixed,
				) as never,
		);
		await runLoad();

		expect(hasPaceChoice(seededLobbyGames())).toBe(true);
	});
});

// The lobby's pace filter initializes from the ?pace= query param (a shared link
// restores the filter) — mirrored on the boardgame page and the /games page.
describe("home lobby — pace filter URL init", () => {
	it("initializes from ?pace=live / ?pace=async, ignoring invalid values", () => {
		// The exact expression +page.svelte uses for its lobbyPace initializer.
		const initPace = () => {
			const param = page.url.searchParams.get("pace");
			return param === "live" || param === "async" ? param : "";
		};
		// The $app/state mock's `url` is a plain URL; the typed `$app/state` narrows
		// the pathname to known routes, which doesn't apply to the mock.
		const setUrl = (href: string) => {
			page.url = new URL(href) as typeof page.url;
		};

		setUrl("http://localhost/?pace=live");
		expect(initPace()).toBe("live");

		setUrl("http://localhost/?pace=async");
		expect(initPace()).toBe("async");

		setUrl("http://localhost/?pace=bogus");
		expect(initPace()).toBe("");

		setUrl("http://localhost/");
		expect(initPace()).toBe("");
	});
});

// The chip-visibility anchoring rule: the parent derives hasPaceChoice from the
// last lobby list fetched WITHOUT a pace filter — never from the filtered list.
// A filtered list (single pace, or empty) must therefore never reach the filter
// component: with one live + one async game, filtering to live keeps the chips.
describe("home lobby — pace chips anchored to the unfiltered set", () => {
	const liveGame = { _id: "g-live", options: { timing: { timePerGame: 3600 } } } as unknown as GameFront;
	const asyncGame = { _id: "g-async", options: { timing: { timePerGame: 172800 } } } as unknown as GameFront;

	it("the unfiltered set keeps the chips visible where the filtered set would not", () => {
		const unfiltered = [liveGame, asyncGame];
		const filteredToLive = [liveGame]; // what GameList binds back with pace=live
		const filteredToNothing: GameFront[] = []; // a filter matching no open game

		// The parent passes the unfiltered set — the regression case from the bug:
		// had it passed the filtered list, hasPaceChoice would flip to false and
		// the chips would vanish, stranding the user on the live filter.
		expect(hasPaceChoice(unfiltered)).toBe(true);
		expect(hasPaceChoice(filteredToLive)).toBe(false);
		expect(hasPaceChoice(filteredToNothing)).toBe(true); // empty is safe either way
	});
});
