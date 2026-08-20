// Tests for the boardgame page load's "Featured games" fallback: when the boardgame
// has no ongoing games, the section shows recently finished ones instead of staying
// empty. Mirrors the pre-existing "My games" fallback (myGamesStatus).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ get: vi.fn(), ApiError: class extends Error {} }));

import { get } from "@/lib/api";
import { clearGamesCache, gameListParams, loadGames } from "@/lib/games.svelte";
import { load } from "./+page";
import type { PageLoad } from "./$types";

const getMock = vi.mocked(get);

// The load only branches on list emptiness; game payloads stay minimal.
function mockApi({ active = [] as unknown[], ended = [] as unknown[] }) {
	getMock.mockImplementation((url: string) => {
		if (url === "/game/status/active") {
			return Promise.resolve(active) as never;
		}
		if (url === "/game/status/ended") {
			return Promise.resolve(ended) as never;
		}
		// Lobby sample + elo rankings — not under test.
		return Promise.resolve([]) as never;
	});
}

function runLoad() {
	return load({
		params: { boardgameId: "testgame" },
		parent: () => Promise.resolve({ user: null, gameInfo: null }),
	} as unknown as Parameters<PageLoad>[0]) as Promise<{
		featuredStatus: "active" | "ended";
		gameRequests: unknown[];
	}>;
}

describe("boardgame page load — featured games fallback", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
	});

	it('stays "active" when the boardgame has ongoing games (no ended fetch)', async () => {
		mockApi({ active: [{ _id: "g1" }], ended: [{ _id: "g2" }] });

		const data = await runLoad();

		expect(data.featuredStatus).toBe("active");
		expect(getMock.mock.calls.map(([url]) => url)).not.toContain("/game/status/ended");
	});

	it('falls back to "ended" when there are no ongoing games but finished ones exist', async () => {
		mockApi({ ended: [{ _id: "g2" }] });

		const data = await runLoad();

		expect(data.featuredStatus).toBe("ended");
		// The ended games were stored in the cache for the GameList to pick up.
		const cached = await loadGames(
			gameListParams({ gameStatus: "ended", boardgameId: "testgame", topRecords: true, perPage: 5 }),
		);
		expect(cached.games).toEqual([{ _id: "g2" }]);
		// Served from the cache — exactly one ended fetch happened (in the load).
		expect(getMock.mock.calls.filter(([url]) => url === "/game/status/ended")).toHaveLength(1);
	});

	it('stays "active" when the boardgame has neither ongoing nor finished games', async () => {
		mockApi({});

		const data = await runLoad();

		expect(data.featuredStatus).toBe("active");
	});
});

describe("boardgame page load — game requests", () => {
	beforeEach(() => {
		clearGamesCache();
		getMock.mockReset();
	});

	it("prefetches the game's feedback requests (SSR)", async () => {
		const requests = [{ _id: "req1", kind: "game", game: "testgame", title: "New map" }];
		getMock.mockImplementation((url: string) => {
			if (url === "/feedback") {
				return Promise.resolve(requests) as never;
			}
			return Promise.resolve([]) as never;
		});

		const data = await runLoad();

		expect(getMock).toHaveBeenCalledWith("/feedback", { kind: "game", game: "testgame" });
		expect(data.gameRequests).toEqual(requests);
	});

	it("falls back to an empty list when the feedback fetch fails", async () => {
		getMock.mockImplementation((url: string) => {
			if (url === "/feedback") {
				return Promise.reject(new Error("feedback down")) as never;
			}
			return Promise.resolve([]) as never;
		});

		const data = await runLoad();

		expect(data.gameRequests).toEqual([]);
	});
});
