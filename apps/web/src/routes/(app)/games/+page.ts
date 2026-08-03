import type { PageLoad } from "./$types";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";

export const load: PageLoad = async () => {
	clearGamesCache();
	// The global games page is not scoped to a specific boardgame.
	const boardgameId = undefined;

	const [featured, lobby] = await Promise.all([
		loadGames({ gameStatus: "active", boardgameId, store: true }),
		loadGames({ gameStatus: "open", boardgameId, store: true }),
	]);

	return { featured, lobby, boardgameId };
};
