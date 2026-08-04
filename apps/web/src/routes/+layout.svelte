<script lang="ts">
	import { Notifications } from "@/components";
	import { provideGameInfos } from "@/lib/game-info.svelte";
	import type { Snippet } from "svelte";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	// Provide the game-info list to all descendants via context (available during SSR and
	// on the client). The load re-runs on invalidateAll; an effect re-provides fresh data.
	$effect(() => {
		provideGameInfos(data.gameInfos ?? {});
	});
</script>

{@render children()}

<Notifications />
