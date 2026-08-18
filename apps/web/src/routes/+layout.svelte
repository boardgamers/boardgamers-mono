<script lang="ts">
	import { page } from "$app/state";
	import { Notifications } from "@/components";
	import { provideGameInfos } from "@/lib/game-info.svelte";
	import { provideTimezone } from "@/lib/timezone";
	import { absoluteUrl, resolveSeo, siteName, type SeoData } from "@/lib/seo";
	import type { Snippet } from "svelte";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	// SSR: provide the game-info list via context during init so descendants render it
	// server-side (setContext must run at init; $effect does NOT run during SSR). The load
	// re-runs on invalidateAll, so a fresh page render re-provides fresh data.
	const gameInfos = () => data.gameInfos ?? {};
	provideGameInfos(gameInfos());

	// Provide the timezone during component init too: $effect (and thus the
	// provideTimezone in +layout.ts) does NOT run during SSR, and descendants read
	// the context while rendering server-side (GameList's initial load is sync).
	// The timezone is constant for the request — capturing the initial data is intended.
	// svelte-ignore state_referenced_locally
	provideTimezone(data.timezone ?? "UTC");

	// Single source of truth for the head: `page.data.seo`, merged by SvelteKit from the
	// page's load() BEFORE render, so the page's values are present when this head
	// serializes (the layout head runs before children — a store/context can't work).
	// Exactly one og:image / twitter:image / og:title is emitted per page.
	const s = $derived(resolveSeo(page.data.seo as SeoData | undefined));
</script>

<svelte:head>
	<title>{s.title}</title>
	<meta name="description" content={s.description} />
	{#if s.noindex}
		<meta name="robots" content="noindex, nofollow" />
	{/if}
	<link rel="canonical" href={page.url.origin + page.url.pathname} />

	<meta property="og:site_name" content={siteName} />
	<meta property="og:type" content={s.type} />
	<meta property="og:title" content={s.title} />
	<meta property="og:description" content={s.description} />
	<meta property="og:url" content={page.url.origin + page.url.pathname} />
	{#if s.image}
		<meta property="og:image" content={absoluteUrl(page.url.origin, s.image)} />
		{#if s.imageWidth}
			<meta property="og:image:width" content={String(s.imageWidth)} />
		{/if}
		{#if s.imageHeight}
			<meta property="og:image:height" content={String(s.imageHeight)} />
		{/if}
	{/if}

	<meta name="twitter:card" content={s.image ? "summary_large_image" : "summary"} />
	<meta name="twitter:title" content={s.title} />
	<meta name="twitter:description" content={s.description} />
	{#if s.image}
		<meta name="twitter:image" content={absoluteUrl(page.url.origin, s.image)} />
	{/if}
</svelte:head>

{@render children()}

<Notifications />
