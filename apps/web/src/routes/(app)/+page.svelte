<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import SanitizedHtml from "@/components/SanitizedHtml.svelte";
	import { GameListSidebar } from "@/components";
	import { Button } from "@/modules/cdk";
	import marked from "marked";
	import GameList from "@/components/Game/GameList.svelte";
	import { account } from "@/lib/account.svelte";
	import { activeGames, live } from "@/lib/stores.svelte";
	import { page } from "$app/state";
	import type { UserFront } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	let announcement = $derived(data.announcement);

	// SSR renders the snapshot; the client trusts the seeded stores (see the invariant in
	// stores.svelte.ts), so the homepage doesn't flicker between "My games" and "Featured".
	let user = $derived(live($account, (page.data.user as UserFront | null) ?? null));
	let myGames = $derived(live($activeGames, (page.data.activeGames as string[]) ?? []));

	let websiteJsonLd = $derived(
		JSON.stringify({
			"@context": "https://schema.org",
			"@type": "WebSite",
			name: "Boardgamers",
			url: page.url.origin,
			description:
				"Play Gaia Project, Powergrid, 6nimmt and Container online with other people. All games and the platform are open source!",
		})
	);
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- JSON-LD is built from static strings, no user input. -->
	{@html `<script type="application/ld+json">${websiteJsonLd}</scr` + `ipt>`}
</svelte:head>

<div class="flex">
	<GameListSidebar />

	<div class="container mx-auto px-4">
		<!-- Hero -->
		<header class="py-6 text-center">
			<p class="text-lg font-light">
				Play <a
					class="no-link font-semibold text-accent dark:text-accent-lighter"
					href={resolve("/(app)/boardgame/[boardgameId]", { boardgameId: "gaia-project" })}>Gaia Project</a
				>,
				<a
					class="no-link font-semibold text-accent dark:text-accent-lighter"
					href={resolve("/(app)/boardgame/[boardgameId]", { boardgameId: "powergrid" })}>Powergrid</a
				>,
				<a
					class="no-link font-semibold text-accent dark:text-accent-lighter"
					href={resolve("/(app)/boardgame/[boardgameId]", { boardgameId: "take6" })}>6nimmt</a
				>
				and
				<a
					class="no-link font-semibold text-accent dark:text-accent-lighter"
					href={resolve("/(app)/boardgame/[boardgameId]", { boardgameId: "container" })}>Container</a
				>
				online
			</p>
			<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
				Want live games? <a href="https://discord.gg/EgqK3rD">Join the discord</a>!
			</p>

			{#if announcement?.content}
				<aside
					class="mx-auto mt-5 w-fit max-w-xl rounded-lg border border-accent/60 bg-accent/5 px-4 py-3 text-left dark:border-accent-light/50 dark:bg-accent/10"
				>
					<div class="mb-1 text-base font-semibold text-accent dark:text-accent-lighter">{announcement.title}</div>
					<div class="announcement-content"><SanitizedHtml html={marked(announcement.content)} /></div>
				</aside>
			{/if}
		</header>

		{#if user && myGames.length === 0}
			<!-- Logged in but no games: a full-width welcome banner above the game lists. -->
			<div
				class="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 px-4 py-3 dark:from-primary/20 dark:to-accent/20"
			>
				<span class="text-sm font-medium">Welcome back! Ready to play?</span>
				<span class="flex gap-2">
					<Button color="primary" size="sm" href={"/new-game" as Pathname} data-sveltekit-preload-data="hover"
						>New Game</Button
					>
					<Button color="accent" size="sm" href={"/games" as Pathname} data-sveltekit-preload-data="hover"
						>Browse lobby</Button
					>
				</span>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<div>
				{#if myGames.length > 0}
					<GameList gameStatus="active" userId={user?._id} perPage={5} title="My games" />
				{:else}
					<GameList gameStatus="active" topRecords perPage={5} title="Featured games" />
				{/if}
			</div>
			<div>
				<GameList sample perPage={5} gameStatus="open" title="Lobby" />
			</div>
		</div>

		<div class="mt-4 flex justify-center gap-3">
			<Button color="accent" href={"/games" as Pathname}>All games</Button>
			<Button color="primary" href={"/new-game" as Pathname} data-sveltekit-preload-data="hover">New Game</Button>
		</div>
	</div>
</div>

<style>
	:global(.announcement-content p) {
		margin-bottom: 0;
	}
</style>
