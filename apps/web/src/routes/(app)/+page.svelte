<script lang="ts">
	import { SEO, GameListSidebar } from "@/components";
	import { Button } from "@/modules/cdk";
	import marked from "marked";
	import GameList from "@/components/Game/GameList.svelte";
	import { account } from "@/lib/account.svelte";
	import { activeGames } from "@/lib/stores.svelte";
	import { page } from "$app/state";
	import type { UserFront } from "@bgs/models";

	let { data }: { data: { announcement?: { title: string; content: string } } } = $props();
	let announcement = $derived(data.announcement);

	// Client prefers the stores (seeded by the layout); SSR falls back to page.data so
	// the homepage doesn't flicker between "My games" and "Featured games".
	let user = $derived(($account ?? page.data.user) as UserFront | null);
	let myGames = $derived($activeGames.length > 0 ? $activeGames : ((page.data.activeGames as string[]) ?? []));
</script>

<SEO />

<div class="flex">
	<GameListSidebar />

	<div class="container mx-auto px-4">
		<div class="flex flex-col py-2 text-lg font-light">
			<p class="text-center">
				Play <b
					><a class="no-link text-accent dark:text-accent-lighter" href="/boardgame/gaia-project">Gaia Project</a></b
				>,
				<b><a class="no-link text-accent dark:text-accent-lighter" href="/boardgame/powergrid">Powergrid</a></b>,
				<b><a class="no-link text-accent dark:text-accent-lighter" href="/boardgame/take6">6nimmt</a></b>
				and <b><a class="no-link text-accent dark:text-accent-lighter" href="/boardgame/container">Container</a></b>
				online<br />Want to set up live games? Join the
				<a href="https://discord.gg/EgqK3rD">discord</a>!
			</p>
			<div class="mx-auto mt-6 block w-fit rounded-md border border-accent dark:border-accent-light px-3 pb-3">
				<div class="py-1 text-center text-base font-normal dark:text-gray-300">{data.announcement?.title}</div>
				<div class="text-left announcement-content">
					{@html marked(data.announcement?.content || "")}
				</div>
			</div>
		</div>
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
			<div class="mt-3">
				{#if myGames.length > 0}
					<GameList gameStatus="active" userId={user?._id} perPage={5} title="My games" />
				{:else if user}
					<!-- Logged in but no games: guide them to start/join one instead of showing others' games. -->
					<div
						class="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-600"
					>
						<h3 class="mb-1 font-semibold">No games yet</h3>
						<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
							You're not in any active games. Start one, or grab a seat in the lobby.
						</p>
						<div class="flex gap-3">
							<Button color="primary" href="/new-game" data-sveltekit-preload-data="hover">New Game</Button>
							<Button color="accent" href="/games" data-sveltekit-preload-data="hover">Browse lobby</Button>
						</div>
					</div>
				{:else}
					<GameList gameStatus="active" topRecords perPage={5} title="Featured games" />
				{/if}
			</div>
			<div class="mt-3">
				<GameList sample perPage={5} gameStatus="open" title="Lobby" />
			</div>
		</div>
		<div class="mt-3 text-center">
			<Button color="accent" href="/games">All games</Button>
			<Button color="primary" class="ms-3" href="/new-game" data-sveltekit-preload-data="hover">New Game</Button>
		</div>
	</div>
</div>

<style>
	:global(.announcement-content p) {
		margin-bottom: 0;
	}
</style>
