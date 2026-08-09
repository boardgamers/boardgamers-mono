<!-- This file is copied from ../../games/index.svelte-->
<script lang="ts">
	import { fade } from "svelte/transition";
	import { GameList } from "@/components";
	import { Nav, NavItem, NavLink } from "@/modules/cdk";
	import { untrack } from "svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// One-shot init from SSR data — firstTab is a user-toggled local state
	let firstTab = $state(untrack(() => data.firstTab));

	let animating = $state(false);
</script>

<div class="container mx-auto px-4">
	<Nav pills>
		<h1 class="me-3">Games</h1>
		<NavItem><NavLink href="#" onclick={() => (firstTab = true)} active={firstTab}>Active</NavLink></NavItem>
		<NavItem><NavLink href="#" onclick={() => (firstTab = false)} active={!firstTab}>Finished</NavLink></NavItem>
	</Nav>

	{#if firstTab}
		<div
			class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2"
			transition:fade
			onoutroend={() => (animating = false)}
			onoutrostart={() => (animating = true)}
			class:hidden={animating}
		>
			<div class="mb-2">
				<GameList gameStatus="open" title="Lobby" boardgameId={data.boardgameId} />
			</div>
			<div class="mb-2">
				<GameList gameStatus="active" title="Ongoing" boardgameId={data.boardgameId} />
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
