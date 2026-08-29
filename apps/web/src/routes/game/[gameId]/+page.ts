import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { loadGame, loadGamePlayers, loadGameSettings } from "@/lib/game.svelte";
import { getGameInfo } from "@/lib/game-info.svelte";
import { getGamePreferences } from "@/lib/game-preferences.svelte";
import { get, toKitError } from "@/lib/api";
import { gameSeo } from "@/lib/game-seo";

export const load: PageLoad = async ({ params, parent }) => {
	const gameId = params.gameId;

	// Preserve the gameplay API's status: a 404 means the game doesn't exist, but a
	// 500 (e.g. engine failed to load) is a server error and must render as such,
	// not be masked as a "not found".
	const [game, players] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]).catch((err) =>
		toKitError(err, "Failed to load game"),
	);

	// game.game can be absent on legacy/corrupt docs — Mongo validation is "warn"/"moderate",
	// so the schema is not enforced on existing data. Guard before dereferencing.
	if (!game?.game) {
		throw error(404, "Game data is incomplete");
	}

	const sidebarPages = ["rules", "settings", "preferences"].map((kind) => `${game.game.name}:${kind}`);
	const [gameInfo, preferences, existingPages] = await Promise.all([
		getGameInfo(game.game.name, game.game.version),
		getGamePreferences(game.game.name),
		// One existence probe for the game-scoped CMS pages the sidebar links to
		// (`<game>:rules` / `:settings` / `:preferences`): the Rules link and the
		// Settings/Preferences "i" links only render when the target page exists
		// (#429). Non-fatal — a pages-api failure must not break the game page, just
		// hide the links.
		get<{ exists: string[] }>(`/page/_exists?names=${sidebarPages.join(",")}`)
			.then((res) => new Set(res.exists))
			.catch(() => null),
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
		// Booleans only — the sidebar links to /page/<game>/{rules,settings,preferences},
		// it never renders the body. A failed probe (null) hides all three links.
		rulesPage: existingPages?.has(`${game.game.name}:rules`) ?? false,
		settingsPage: existingPages?.has(`${game.game.name}:settings`) ?? false,
		preferencesPage: existingPages?.has(`${game.game.name}:preferences`) ?? false,
		// The SSR request's user (the viewer). The `account` store is null server-side, so
		// components resolve their viewer-gated UI ("Your turn!", "Vote to cancel", the
		// settings panel's playerUser) against this during SSR via `live($account?._id, viewerUserId)`.
		viewerUserId: user?._id ?? null,
		// SSR head snapshot; the game layout overrides it client-side as the game evolves.
		seo: gameSeo(game, gameInfo),
	};
};
