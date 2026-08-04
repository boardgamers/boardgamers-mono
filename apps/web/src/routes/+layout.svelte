<script lang="ts">
	import { Notifications, SEO } from "@/components";
	import { provideGameInfos } from "@/lib/game-info.svelte";
	import type { Snippet } from "svelte";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	// SSR: provide the game-info list via context during init so descendants render it
	// server-side (setContext must run at init; $effect does NOT run during SSR). The load
	// re-runs on invalidateAll, so a fresh page render re-provides fresh data.
	const gameInfos = () => data.gameInfos ?? {};
	provideGameInfos(gameInfos());
</script>

<!-- Default site-wide meta (title/description/OG/canonical); pages override with their own <SEO>. -->
<SEO />

{@render children()}

<Notifications />
