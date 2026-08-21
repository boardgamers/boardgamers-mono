<!-- This file is copied from ../../games/index.svelte-->
<script lang="ts">
	import { fade } from "svelte/transition";
	import { GameList } from "@/components";
	import { Nav, NavItem, NavLink, Input } from "@/modules/cdk";
	import { untrack } from "svelte";
	import { page } from "$app/state";
	import type { GamePace } from "@/utils";
	import type { UserFront } from "@bgs/models";
	import type { PageProps } from "./$types";
	import { m } from "@/lib/i18n/messages";

	let { data }: PageProps = $props();
	// The viewer's karma (SSR snapshot) — threaded into the open-games list (#345).
	let viewerKarma = $derived((page.data.user as UserFront | null)?.account?.karma);

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
			<h1 class="me-3">{m.games_title()}</h1>
			<NavItem
				><NavLink href="#" onclick={() => (firstTab = true)} active={firstTab}>{m.games_active()}</NavLink></NavItem
			>
			<NavItem
				><NavLink href="#" onclick={() => (firstTab = false)} active={!firstTab}>{m.games_finished()}</NavLink></NavItem
			>
		</Nav>
		<div class="w-full sm:w-40">
			<Input type="select" bind:value={pace} aria-label={m.games_paceFilter()}>
				<option value="">{m.games_allPaces()}</option>
				<option value="live">{m.pace_live()}</option>
				<option value="async">{m.pace_async()}</option>
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
				<GameList
					gameStatus="open"
					title={m.games_lobby()}
					boardgameId={data.boardgameId}
					pace={paceFilter}
					{viewerKarma}
				/>
			</div>
			<div class="mb-2">
				<GameList gameStatus="active" title={m.games_ongoing()} boardgameId={data.boardgameId} pace={paceFilter} />
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
				<GameList gameStatus="ended" title={m.games_finished()} boardgameId={data.boardgameId} />
			</div>
		</div>
	{/if}
</div>
