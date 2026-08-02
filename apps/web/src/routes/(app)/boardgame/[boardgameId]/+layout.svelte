<script lang="ts">
	import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
	import { provideGamePreferences } from "@/lib/game-preferences.svelte";
	import type { Snippet } from "svelte";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	// Provide this boardgame's SSR-fetched prefs via context so descendants render them
	// during SSR (the store is browser-only). On the client the layout load's getters
	// (getGameInfo/getGamePreferences) already populate the stores — no seeding needed here.
	if (data.preferences) {
		provideGamePreferences({ [data.preferences.game]: data.preferences });
	}
</script>

<div class="flex flex-row gap-4">
	<GameListSidebar />
	{@render children()}
</div>
