import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { loadGame, loadGamePlayers, loadGameSettings } from "@/lib/game.svelte";
import { getGameInfo } from "@/lib/game-info.svelte";
import { getGamePreferences } from "@/lib/game-preferences.svelte";
import { ApiError } from "@/lib/api";
import { gameSeo } from "@/lib/game-seo";

export const load: PageLoad = async ({ params, parent }) => {
	const gameId = params.gameId;

	let game, players;
	try {
		[game, players] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);
	} catch (err) {
		// Preserve the gameplay API's status: a 404 means the game doesn't exist, but a
		// 500 (e.g. engine failed to load) is a server error and must render as such,
		// not be masked as a "not found".
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Game not found");
		}
		throw error(err instanceof ApiError ? err.status : 500, err instanceof Error ? err.message : "Failed to load game");
	}

	// game.game can be absent on legacy/corrupt docs — Mongo validation is "warn"/"moderate",
	// so the schema is not enforced on existing data. Guard before dereferencing.
	if (!game?.game) {
		throw error(404, "Game data is incomplete");
	}

	const [gameInfo, preferences] = await Promise.all([
		getGameInfo(game.game.name, game.game.version),
		getGamePreferences(game.game.name),
	]);

	// Per-player in-game settings (e.g. Gaia Project's faction-specific toggles). SSR'd so
	// the sidebar's Settings section renders on first paint — no post-hydration pop-in.
	// Awaited after loadGame() so the two /gameplay/* mints don't race on the shared
	// module-level token cache (api.ts#mintToken has no in-flight dedup). `user` comes
	// from the SSR root layout — the request-scoped account, unavailable to a component
	// during SSR (the client store is null there), which is why this lives in the load.
	const { user } = await parent();
	const settings =
		user && game.status === "active" && (gameInfo?.settings?.length ?? 0) > 0
			? await loadGameSettings(gameId).catch(() => null)
			: null;

	return {
		game,
		players,
		gameInfo,
		preferences,
		settings,
		// The SSR request's user (the viewer). The `account` store is null server-side, so
		// components resolve their viewer-gated UI ("Your turn!", "Vote to cancel", the
		// settings panel's playerUser) against this during SSR via `live($account?._id, viewerUserId)`.
		viewerUserId: user?._id ?? null,
		// SSR head snapshot; the game layout overrides it client-side as the game evolves.
		seo: gameSeo(game, gameInfo),
	};
};
