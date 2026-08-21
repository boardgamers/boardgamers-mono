<script lang="ts">
	import { fade } from "svelte/transition";
	import { GameList } from "@/components";
	import { Nav, NavItem, NavLink, Input } from "@/modules/cdk";
	import { goto, replaceState } from "$app/navigation";
	import { browser } from "$app/environment";
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import { page } from "$app/state";
	import { debounce } from "lodash";
	import type { GamePace } from "@/utils";
	import type { UserFront } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// Tab is driven by the ?status= query param so it's linkable and back/forward works.
	let firstTab = $derived(page.url.searchParams.get("status") !== "finished");
	let animating = $state(false);

	function selectTab(active: boolean) {
		const url = new URL(page.url);
		if (active) {
			url.searchParams.delete("status");
		} else {
			url.searchParams.set("status", "finished");
		}
		// Redirect-to-self (the games route) with updated query params.
		const gamesTarget = resolve("/(app)/games") + url.search;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is resolve()d above; the rule can't trace resolve() + query-string concatenation
		goto(gamesTarget, { keepFocus: true, noScroll: true });
	}

	let featuredCount = $derived(data.featured);
	let lobbyCount = $derived(data.lobby);

	// Text filter (debounced) — filters by game id server-side across the full list.
	let searchInput = $state("");
	let search = $state<string | undefined>(undefined);
	const applySearch = debounce((val: string) => {
		search = val.trim() || undefined;
	}, 300);
	$effect(() => {
		applySearch(searchInput);
	});

	// Live/async pace filter (#55) — "" = no filter. Passed to each GameList, which
	// maps it to a server-side timePerGame bound. Initialized from ?pace= so a shared
	// link restores the filter; kept in sync by the effect below.
	const initialPace = page.url.searchParams.get("pace");
	let pace = $state<"" | GamePace>(initialPace === "live" || initialPace === "async" ? initialPace : "");
	let paceFilter = $derived<GamePace | undefined>(pace === "" ? undefined : pace);
	// Reflect the filter in the URL without a history entry or a navigation.
	$effect(() => {
		if (!browser) {
			return;
		}
		const url = new URL(page.url);
		if (pace === "") {
			url.searchParams.delete("pace");
		} else {
			url.searchParams.set("pace", pace);
		}
		if (url.href !== page.url.href) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- only the query string changes; the pathname is already the current route
			replaceState(url, page.state);
		}
	});
	// The viewer's karma (SSR snapshot) — threaded into the open-games list (#345).
	let viewerKarma = $derived((page.data.user as UserFront | null)?.account?.karma);
</script>

<div class="container mx-auto px-4">
	<div class="flex flex-wrap items-center gap-3">
		<Nav pills class="flex-1">
			<h1 class="me-3">Games</h1>
			<NavItem><NavLink href="?" onclick={() => selectTab(true)} active={firstTab}>Active</NavLink></NavItem>
			<NavItem
				><NavLink href="?status=finished" onclick={() => selectTab(false)} active={!firstTab}>Finished</NavLink
				></NavItem
			>
		</Nav>
		<div class="w-full sm:w-40">
			<Input type="select" bind:value={pace} aria-label="Filter by game pace">
				<option value="">All paces</option>
				<option value="live">⚡ Live</option>
				<option value="async">🐢 Async</option>
			</Input>
		</div>
		<div class="w-full sm:w-64">
			<Input
				type="search"
				placeholder="Filter by game name…"
				bind:value={searchInput}
				aria-label="Filter games by name"
			/>
		</div>
	</div>

	{#if firstTab}
		<div
			class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2"
			transition:fade
			onoutroend={() => (animating = false)}
			onoutrostart={() => (animating = true)}
			class:hidden={animating}
		>
			<div class="mb-2">
				<GameList
					gameStatus="open"
					title="Lobby"
					boardgameId={data.boardgameId}
					pace={paceFilter}
					{search}
					{viewerKarma}
				/>
			</div>
			<div class="mb-2">
				<GameList gameStatus="active" title="Ongoing" boardgameId={data.boardgameId} pace={paceFilter} {search} />
			</div>
		</div>
	{:else}
		<div
			class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2"
			transition:fade
			onoutroend={() => (animating = false)}
			onoutrostart={() => (animating = true)}
			class:hidden={animating}
		>
			<div class="mb-2">
				<GameList gameStatus="ended" title="Finished" boardgameId={data.boardgameId} {search} />
			</div>
		</div>
	{/if}
</div>
