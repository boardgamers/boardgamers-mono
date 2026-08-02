import { error } from "@sveltejs/kit";
import type { LayoutLoad } from "./$types";
import { getGameInfo, gameInfoKey } from "@/lib/game-info.svelte";
import { getGamePreferences } from "@/lib/game-preferences.svelte";

export const load: LayoutLoad = async ({ params, parent }) => {
	const { gameInfos } = await parent();

	// A nonexistent boardgame is a 404, not a server error. The root layout fetched the
	// public game list fresh, so check it before the per-game loaders (which would otherwise
	// each hit a 404 and bubble up as a 500).
	if (!gameInfos?.[gameInfoKey(params.boardgameId, "latest")]) {
		throw error(404, `Unknown boardgame: ${params.boardgameId}`);
	}

	// Store-cached getters: in the browser they return the cached value when present (no
	// refetch); on SSR (or a cache miss) they fetch. SSR-safe: returned in load data, never
	// written to the shared store here — the layout component seeds the store on the client.
	const [gameInfo, preferences] = await Promise.all([
		getGameInfo(params.boardgameId, "latest"),
		getGamePreferences(params.boardgameId),
	]);
	return { gameInfo, preferences };
};
