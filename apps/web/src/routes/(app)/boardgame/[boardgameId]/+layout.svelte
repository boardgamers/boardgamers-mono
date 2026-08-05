<script lang="ts">
	import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
	import { provideGamePreferences } from "@/lib/game-preferences.svelte";
	import type { Snippet } from "svelte";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	// SSR: provide this boardgame's SSR-fetched prefs via context during init so descendants
	// render them server-side (setContext must run at init; $effect does NOT run during SSR).
	// On the client the layout load's getters already populate the stores — no seeding here.
	const ssrPreferences = () => data.preferences;
	if (ssrPreferences()) {
		provideGamePreferences({ [ssrPreferences()!.game]: ssrPreferences()! });
	}
</script>

<div class="flex flex-row gap-4">
	<GameListSidebar />
	{@render children()}
</div>
