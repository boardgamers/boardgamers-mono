import type { PageLoad } from "./$types";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import { setApiContext } from "@/lib/api";

export const load: PageLoad = async ({ params, fetch, url }) => {
	setApiContext((prev) => ({ ...prev, fetch }));
	clearGamesCache();
	const boardgameId = params.boardgameId;
	// Start on the "Active" tab unless the URL asks for finished games (?status=ended).
	const firstTab = url.searchParams.get("status") !== "ended";

	const [featured, lobby] = await Promise.all([
		loadGames({ gameStatus: "active", boardgameId, store: true }),
		loadGames({ gameStatus: "open", boardgameId, store: true }),
	]);

	return { featured, lobby, boardgameId, firstTab };
};
