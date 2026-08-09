import type { PageLoad } from "./$types";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import { gameLabel } from "@/utils/game-label";

export const load: PageLoad = async ({ params, url, parent }) => {
	clearGamesCache();
	const boardgameId = params.boardgameId;
	// Start on the "Active" tab unless the URL asks for finished games (?status=ended).
	const firstTab = url.searchParams.get("status") !== "ended";

	const [parentData, featured, lobby] = await Promise.all([
		parent(),
		loadGames({ gameStatus: "active", boardgameId, store: true }),
		loadGames({ gameStatus: "open", boardgameId, store: true }),
	]);
	const label = gameLabel(parentData.gameInfo?.label ?? boardgameId);

	return {
		featured,
		lobby,
		boardgameId,
		firstTab,
		seo: {
			title: `${label} games`,
			description: `${featured.games.length} ongoing games and ${lobby.total} open games of ${label}.`,
		},
	};
};
