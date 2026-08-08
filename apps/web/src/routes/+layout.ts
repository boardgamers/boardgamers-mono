import { browser } from "$app/environment";
import type { LayoutLoad } from "./$types";
import { seedAccountFromSSR, seedActiveGamesFromSSR, sidebarOpen } from "@/lib/stores.svelte";
import { fetchGameInfos } from "@/lib/game-info.svelte";
import type { GameInfoFront } from "@bgs/models";
import type { SetOptional } from "type-fest";
import { initWebsocket } from "@/lib/websocket.svelte";
import { get } from "@/lib/api";
import { initNProgress } from "@/lib/nprogress.svelte";
import { initErrorReporting } from "@/lib/report-error.svelte";
import "@/lib/theme";

export const load: LayoutLoad = async ({ data }) => {
	// Sidebar open is a non-sensitive UI preference — safe to set during SSR.
	if (data?.sidebarOpen !== undefined) {
		sidebarOpen.set(data.sidebarOpen);
	}

	// Public game-info list, fetched fresh per request (SSR-safe: returned, not stored).
	// The root layout component seeds the reactive store from this on the browser, so
	// SSR always renders current game data (no shared 1-hour server cache).
	const gameInfos: Record<string, SetOptional<GameInfoFront, "viewer">> = await fetchGameInfos().catch(() => ({}));

	// Boardgames the player has played, ordered by recency — the sidebar's pinned "My
	// games" group. SSR-safe (request-scoped fetch via getRequestEvent), so the divider
	// and pinned group render on first paint, not after hydration.
	let myBoardgames: string[] = [];
	if (data?.user?._id) {
		myBoardgames = await get<{ boardgame: string; lastActivity: string }[]>("/game/my-boardgames", {
			user: data.user._id,
		})
			.then((rows) => rows.map((r) => r.boardgame))
			.catch(() => []);
	}

	if (browser) {
		// Seed the client stores from the SSR snapshot. These are no-ops on a
		// same-identity revalidation (see the "seed once per identity" invariant in
		// stores.svelte.ts), so `invalidateAll()` re-runs don't clobber live state,
		// while login/logout (identity change) re-seed from the fresh snapshot.
		const user = data?.user ?? null;
		seedAccountFromSSR(user);
		seedActiveGamesFromSSR(data?.activeGames ?? [], user?._id ?? null);

		initWebsocket();
		initNProgress();
		initErrorReporting();
	}

	// Pass through the layout data so child pages can access it via `await parent()`
	return {
		user: data?.user ?? null,
		activeGames: data?.activeGames ?? [],
		myBoardgames,
		gameInfos,
	};
};
