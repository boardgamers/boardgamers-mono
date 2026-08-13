import type { PageLoad } from "./$types";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import { loadEloRankings } from "@/lib/elo-rankings.svelte";
import { shareImageUrl, stripMarkdown, truncate } from "@/lib/seo";
import { gameDisplayName } from "@/utils/game-label";

export const load: PageLoad = async ({ params, parent }) => {
	const { user, gameInfo } = await parent();

	// Clear stale cache from previous navigation so GameList components always
	// see fresh data from this page's pre-fetched results.
	clearGamesCache();
	const boardgameId = params.boardgameId;
	const userId = user?._id;

	const myActiveGames = loadGames({
		gameStatus: "active",
		count: 5,
		boardgameId,
		userId,
		fetchCount: false,
		store: true,
	});

	const featuredGames = loadGames({ gameStatus: "active", count: 5, boardgameId, fetchCount: false, store: true });

	const lobbyGames = loadGames({ sample: true, gameStatus: "open", boardgameId, count: 5, store: true });

	const [active, , , rankings] = await Promise.all([
		myActiveGames,
		featuredGames,
		lobbyGames,
		loadEloRankings({ boardgameId, count: 6, fetchCount: false }),
	]);

	// If the player has no active games of this boardgame, fall back to their finished
	// games for "My games" (so the section isn't empty when they've only completed games).
	let myGamesFallback: "active" | "ended" = "active";
	if (userId && active.games.length === 0) {
		const ended = await loadGames({
			gameStatus: "ended",
			count: 5,
			boardgameId,
			userId,
			fetchCount: false,
			store: true,
		});
		if (ended.games.length > 0) {
			myGamesFallback = "ended";
		}
	}

	return {
		rankings,
		myGamesStatus: myGamesFallback,
		seo: {
			title: gameInfo ? gameDisplayName(gameInfo, { emoji: false }) : boardgameId,
			description: truncate(
				stripMarkdown(gameInfo?.description ?? "") ||
					`Play ${gameInfo ? gameDisplayName(gameInfo, { emoji: false }) : boardgameId} online with other people!`,
				200,
			),
			image: shareImageUrl({ kind: "boardgame", id: boardgameId }),
		},
	};
};
