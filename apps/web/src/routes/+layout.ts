import { browser } from "$app/environment";
import type { LayoutLoad } from "./$types";
import { activeGames, setAccount, sidebarOpen } from "@/lib/stores.svelte";
import { initTokens } from "@/lib/auth.svelte";
import { initWebsocket } from "@/lib/websocket.svelte";
import { setApiContext, get } from "@/lib/api";
import { initNProgress } from "@/lib/nprogress.svelte";
import { initErrorReporting } from "@/lib/report-error.svelte";
import "@/lib/theme";

export const load: LayoutLoad = async ({ data, fetch }) => {
	initTokens();

	// Use event.fetch for SSR (handles relative URLs + proxy rewriting).
	// On the client, this is the browser's native fetch.
	setApiContext((prev) => ({ ...prev, fetch }));

	// Sync sidebar open state from cookie on both SSR and client
	if (data?.sidebarOpen !== undefined) {
		sidebarOpen.set(data.sidebarOpen);
	}

	if (browser) {
		// Seed stores from the initial SSR data (client only — a module-level
		// store mutated during SSR would leak across concurrent requests).
		setAccount(data?.user ?? null);
		if (data?.activeGames) {
			activeGames.set(data.activeGames);
		}

		initWebsocket();
		initNProgress();
		initErrorReporting();
	}

	// Boardgames the player has played, ordered by recency — used by the sidebar's
	// "My games" pinned group. Fetched here (not in the component) so SSR renders the
	// pinned list immediately instead of popping it in after hydration.
	let myBoardgames: string[] = [];
	if (data?.user?._id) {
		myBoardgames = await get<{ boardgame: string; lastActivity: string }[]>("/game/my-boardgames", {
			user: data.user._id,
		})
			.then((rows) => rows.map((r) => r.boardgame))
			.catch(() => []);
	}

	// Pass through the layout data so child pages can access it via `await parent()`
	return {
		user: data?.user ?? null,
		activeGames: data?.activeGames ?? [],
		myBoardgames,
	};
};
