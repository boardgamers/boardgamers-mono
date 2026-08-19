import type { PageLoad } from "./$types";
import { loadGames, clearGamesCache, gameListParams } from "@/lib/games.svelte";

export const load: PageLoad = async ({ parent }) => {
	clearGamesCache();
	// The global games page is not scoped to a specific boardgame.
	const boardgameId = undefined;
	// viewerKarma (SSR snapshot) keeps the server prefetch + client read on the same
	// cache key (#345).
	const { user } = await parent();
	const viewerKarma = user?.account?.karma;

	const [featured, lobby] = await Promise.all([
		loadGames({ ...gameListParams({ gameStatus: "active", boardgameId }), store: true }),
		loadGames({ ...gameListParams({ gameStatus: "open", boardgameId, viewerKarma }), store: true }),
	]);

	return {
		featured,
		lobby,
		boardgameId,
		seo: {
			title: "All games",
			description: `${featured.total} ongoing games and ${lobby.total} open games. Join one or create your own!`,
		},
	};
};
