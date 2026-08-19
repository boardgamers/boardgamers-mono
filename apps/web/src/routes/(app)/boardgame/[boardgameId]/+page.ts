import type { PageLoad } from "./$types";
import { loadGames, clearGamesCache, gameListParams } from "@/lib/games.svelte";
import { loadEloRankings } from "@/lib/elo-rankings.svelte";
import { boardgameSeo } from "@/lib/boardgame-seo";
import { get } from "@/lib/api";
import type { PageFront } from "@bgs/models";

export const load: PageLoad = async ({ params, parent }) => {
	const { user, gameInfo } = await parent();

	// Clear stale cache from previous navigation so GameList components always
	// see fresh data from this page's pre-fetched results.
	clearGamesCache();
	const boardgameId = params.boardgameId;
	const userId = user?._id;

	// gameListParams mirrors the GameLists in +page.svelte exactly — the cache key
	// must match the component's request for the SSR render to find the seeded entry.
	const myActiveGames = loadGames({
		...gameListParams({ gameStatus: "active", boardgameId, userId, topRecords: true, perPage: 5 }),
		store: true,
	});

	const featuredGames = loadGames({
		...gameListParams({ gameStatus: "active", boardgameId, topRecords: true, perPage: 5 }),
		store: true,
	});

	const lobbyGames = loadGames({
		...gameListParams({ gameStatus: "open", boardgameId, sample: true, perPage: 5 }),
		store: true,
	});

	// Per-game credits CMS page — most games have none (404 → null, section hidden).
	const credits = get<PageFront>(`/page/${boardgameId}:credits`).catch(() => null);

	const [active, featured, , rankings, creditsPage] = await Promise.all([
		myActiveGames,
		featuredGames,
		lobbyGames,
		loadEloRankings({ boardgameId, count: 6, fetchCount: false }),
		credits,
	]);

	// If the player has no active games of this boardgame, fall back to their finished
	// games for "My games" (so the section isn't empty when they've only completed games).
	let myGamesFallback: "active" | "ended" = "active";
	if (userId && active.games.length === 0) {
		const ended = await loadGames({
			...gameListParams({ gameStatus: "ended", boardgameId, userId, topRecords: true, perPage: 5 }),
			store: true,
		});
		if (ended.games.length > 0) {
			myGamesFallback = "ended";
		}
	}

	// Same fallback for "Featured games": when the boardgame has no ongoing games,
	// show recently finished ones instead of an empty section.
	let featuredFallback: "active" | "ended" = "active";
	if (featured.games.length === 0) {
		const ended = await loadGames({
			...gameListParams({ gameStatus: "ended", boardgameId, topRecords: true, perPage: 5 }),
			store: true,
		});
		if (ended.games.length > 0) {
			featuredFallback = "ended";
		}
	}

	return {
		rankings,
		creditsPage,
		myGamesStatus: myGamesFallback,
		featuredStatus: featuredFallback,
		seo: boardgameSeo(boardgameId, gameInfo),
	};
};
