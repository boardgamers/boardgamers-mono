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
import { clearGamesCache, gameListParams, loadGames, type LoadGamesResult } from "@/lib/games.svelte";
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
