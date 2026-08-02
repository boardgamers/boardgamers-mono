import type { PageLoad } from "./$types";
import { getAllGamePreferences } from "@/lib/game-preferences.svelte";

export const load: PageLoad = async () => {
	// Store-cached: browser returns the cached store when present (no refetch), else fetches
	// and populates the store; SSR fetches and returns (no store write). Returned in load
	// data so the page can provide it via context for SSR ownership styling.
	return { gamePreferences: await getAllGamePreferences() };
};
