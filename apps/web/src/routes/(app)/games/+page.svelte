<script lang="ts">
	import { fade } from "svelte/transition";
	import { GameList, SEO } from "@/components";
	import { Nav, NavItem, NavLink, Input } from "@/modules/cdk";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import { page } from "$app/state";
	import { debounce } from "lodash";
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
</script>

<SEO title="All games" description={`${featuredCount} ongoing games and ${lobbyCount} open games.`} />

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
				<GameList gameStatus="open" title="Lobby" boardgameId={data.boardgameId} {search} />
			</div>
			<div class="mb-2">
				<GameList gameStatus="active" title="Ongoing" boardgameId={data.boardgameId} {search} />
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
