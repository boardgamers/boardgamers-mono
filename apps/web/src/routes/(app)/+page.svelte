<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import SanitizedHtml from "@/components/SanitizedHtml.svelte";
	import { GameListSidebar, LobbyChat, SetupOptionsFilter } from "@/components";
	import { Button } from "@/modules/cdk";
	import marked from "marked";
	import GameList from "@/components/Game/GameList.svelte";
	import { account } from "@/lib/account.svelte";
	import { activeGames, live } from "@/lib/stores.svelte";
	import { page } from "$app/state";
	import { replaceState } from "$app/navigation";
	import { browser } from "$app/environment";
	import { untrack } from "svelte";
	import type { GamePace } from "@/utils";
	import type { GameFront, UserFront } from "@bgs/models";
	import { peekGames, gameListParams } from "@/lib/games.svelte";
	import { m } from "@/lib/i18n/messages";
	import HeroTagline from "@/components/HeroTagline.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	let announcement = $derived(data.announcement);

	// SSR renders the snapshot; the client trusts the seeded stores (see the invariant in
	// stores.svelte.ts), so the homepage doesn't flicker between "My games" and "Featured".
	let user = $derived(live($account, (page.data.user as UserFront | null) ?? null));
	let myGames = $derived(live($activeGames, (page.data.activeGames as string[]) ?? []));

	// Lobby pace filter (#55) — "" = no filter. Initialized from ?pace= so a shared
	// link restores the filter; kept in sync by the effect below.
	const initialPace = page.url.searchParams.get("pace");
	let lobbyPace = $state<"" | GamePace>(initialPace === "live" || initialPace === "async" ? initialPace : "");
	let lobbyPaceFilter = $derived<GamePace | undefined>(lobbyPace === "" ? undefined : lobbyPace);
	// Reflect the filter in the URL without a history entry or a navigation (the
	// lobby's games come from the client-side games cache, not the page load).
	$effect(() => {
		if (!browser) {
			return;
		}
		const url = new URL(page.url);
		if (lobbyPace === "") {
			url.searchParams.delete("pace");
		} else {
			url.searchParams.set("pace", lobbyPace);
		}
		if (url.href !== page.url.href) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- only the query string changes; the pathname is already the current route
			replaceState(url, page.state);
		}
	});
	// The lobby's loaded open games. Seeded once (untrack) from the +page.ts prefetch
	// cache so the SSR render (where the child's bind-back hasn't run yet) derives the
	// same filter visibility as hydration.
	let lobbyGames = $state<GameFront[]>(
		untrack(
			() =>
				peekGames(gameListParams({ gameStatus: "open", sample: true, perPage: 5, viewerKarma: user?.account?.karma }))
					?.games ?? []
		)
	);
	// The last lobby list fetched WITHOUT a pace filter — what the pace chips derive
	// their visibility from. Anchoring to the unfiltered set keeps the chips rendered
	// after filtering narrows the list to a single pace (or to nothing), which is
	// exactly when the user needs them to switch back.
	let unfilteredLobbyGames = $state<GameFront[]>(untrack(() => lobbyGames));
	$effect(() => {
		if (lobbyPaceFilter === undefined) {
			unfilteredLobbyGames = lobbyGames;
		}
	});

	let websiteJsonLd = $derived(
		JSON.stringify({
			"@context": "https://schema.org",
			"@type": "WebSite",
			name: "Boardgamers",
			url: page.url.origin,
			description: m.seo_homeDescription(),
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
			<HeroTagline />
			<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
				{m.home_hero_discord()} <a href="https://discord.gg/EgqK3rD">{m.home_hero_discordLink()}</a>!
			</p>

			{#if announcement?.content}
				<aside
					class="mx-auto mt-5 w-fit max-w-xl rounded-lg border border-accent/60 bg-accent/5 px-4 py-3 text-left dark:border-accent-light/50 dark:bg-accent/10"
				>
					<div class="mb-1 flex items-baseline justify-between gap-4">
						<div class="text-base font-semibold text-accent dark:text-accent-lighter">{m.home_recentChanges()}</div>
						<a
							href={resolve("/(app)/changelog")}
							class="shrink-0 text-xs font-medium text-accent hover:underline dark:text-accent-lighter"
							>{m.home_viewAll()}</a
						>
					</div>
					<div class="announcement-content"><SanitizedHtml html={marked(announcement.content)} /></div>
				</aside>
			{/if}
		</header>

		{#if user && myGames.length === 0}
			<!-- Logged in but no games: a full-width welcome banner above the game lists. -->
			<div
				class="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 px-4 py-3 dark:from-primary/20 dark:to-accent/20"
			>
				<span class="text-sm font-medium">{m.home_welcomeBack()}</span>
				<span class="flex gap-2">
					<Button color="primary" size="sm" href={"/new-game" as Pathname} data-sveltekit-preload-data="hover"
						>{m.home_newGame()}</Button
					>
					<Button color="accent" size="sm" href={"/games" as Pathname} data-sveltekit-preload-data="hover"
						>{m.home_browseLobby()}</Button
					>
				</span>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<div>
				{#if myGames.length > 0}
					<GameList gameStatus="active" userId={user?._id} perPage={5} title={m.home_myGames()} />
				{:else}
					<GameList gameStatus="active" topRecords perPage={5} title={m.home_featuredGames()} />
				{/if}
			</div>
			<div>
				<GameList
					sample
					perPage={5}
					gameStatus="open"
					title={m.home_lobby()}
					pace={lobbyPaceFilter}
					viewerKarma={user?.account?.karma}
					bind:games={lobbyGames}
				>
					{#snippet headerContent()}
						<SetupOptionsFilter games={unfilteredLobbyGames} bind:pace={lobbyPace} />
					{/snippet}
				</GameList>
			</div>
		</div>

		<div class="mt-4 flex justify-center gap-3">
			<Button color="accent" href={"/games" as Pathname}>{m.home_allGames()}</Button>
			<Button color="primary" href={"/new-game" as Pathname} data-sveltekit-preload-data="hover"
				>{m.home_newGame()}</Button
			>
		</div>
	</div>
</div>

<LobbyChat />

<style>
	:global(.announcement-content p) {
		margin-bottom: 0;
	}
</style>
