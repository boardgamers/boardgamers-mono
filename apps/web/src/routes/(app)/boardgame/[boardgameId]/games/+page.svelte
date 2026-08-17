<!-- This file is copied from ../../games/index.svelte-->
<script lang="ts">
	import { fade } from "svelte/transition";
	import { GameList } from "@/components";
	import { Nav, NavItem, NavLink, Input } from "@/modules/cdk";
	import { untrack } from "svelte";
	import type { GamePace } from "@/utils";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// One-shot init from SSR data — firstTab is a user-toggled local state
	let firstTab = $state(untrack(() => data.firstTab));

	let animating = $state(false);

	// Live/async pace filter (#55) — "" = no filter.
	let pace = $state<"" | GamePace>("");
	let paceFilter = $derived<GamePace | undefined>(pace === "" ? undefined : pace);
</script>

<div class="container mx-auto px-4">
	<div class="flex flex-wrap items-center gap-3">
		<Nav pills class="flex-1">
			<h1 class="me-3">Games</h1>
			<NavItem><NavLink href="#" onclick={() => (firstTab = true)} active={firstTab}>Active</NavLink></NavItem>
			<NavItem><NavLink href="#" onclick={() => (firstTab = false)} active={!firstTab}>Finished</NavLink></NavItem>
		</Nav>
		<div class="w-full sm:w-40">
			<Input type="select" bind:value={pace} aria-label="Filter by game pace">
				<option value="">All paces</option>
				<option value="live">⚡ Live</option>
				<option value="async">🐢 Async</option>
			</Input>
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
				<GameList gameStatus="open" title="Lobby" boardgameId={data.boardgameId} pace={paceFilter} />
			</div>
			<div class="mb-2">
				<GameList gameStatus="active" title="Ongoing" boardgameId={data.boardgameId} pace={paceFilter} />
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
				<GameList gameStatus="ended" title="Finished" boardgameId={data.boardgameId} />
			</div>
		</div>
	{/if}
</div>
