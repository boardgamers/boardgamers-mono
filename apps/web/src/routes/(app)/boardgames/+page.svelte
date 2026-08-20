<script lang="ts">
	import { Card, CardText } from "@/modules/cdk";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import ExpandableMarkdown from "@/components/ExpandableMarkdown.svelte";
	import IconMeeple from "@/components/icons/IconMeeple.svelte";
	import IconMeepleFill from "@/components/icons/IconMeepleFill.svelte";
	import { byGamePopularity, useLatestGameInfos } from "@/lib/game-info.svelte";
	import { gamePreferences, provideGamePreferences } from "@/lib/game-preferences.svelte";
	import { gameBasedOnLabel, gameDisplayName } from "@/utils/game-label";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// Discovery ordering (#98): my likes first, then most liked, display name breaks
	// ties. `$derived.by` (not `$derived(...)`) because useLatestGameInfos reads reactive
	// state — the function must run inside the derived for the read to be tracked.
	let info = $derived.by(() => useLatestGameInfos().slice().sort(byGamePopularity));

	// SSR: provide the SSR-fetched prefs map via context during init so the ownership
	// classes render server-side (setContext must run at init; $effect does NOT run during
	// SSR). On the client the store (seeded by the load's getter) is the reactive source.
	// Read through a function: intentional init-time capture of `data` (no reactivity wanted).
	const ssrPreferences = () => data.gamePreferences;
	if (ssrPreferences()) {
		provideGamePreferences(ssrPreferences()!);
	}

	function owns(gameId: string): boolean {
		return !!($gamePreferences[gameId] ?? ssrPreferences()?.[gameId])?.access?.ownership;
	}
</script>

<div class="container mx-auto px-4">
	<h1 class="mb-1">Game selection</h1>
	<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
		Missing a game? <a href={resolve("/(app)/feedback#game-requests")}>Suggest it</a>
	</p>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		{#each info as game (game._id.game)}
			<div>
				<Card
					header={gameDisplayName(game)}
					class="border-gray-300 h-full cursor-pointer transition-shadow hover:border-primary hover:shadow-lg dark:border-gray-600 dark:hover:border-primary-lighter"
					onclick={() => goto(resolve("/(app)/boardgame/[boardgameId]", { boardgameId: game._id.game }))}
					role="button"
				>
					<CardText>
						{#if gameBasedOnLabel(game)}
							<div class="mb-2 text-sm text-gray-500 dark:text-gray-400">{gameBasedOnLabel(game)}</div>
						{/if}
						<ExpandableMarkdown markdown={game.description} />
					</CardText>
					{#snippet footer()}
						<div class="flex items-center justify-between">
							<span
								class:text-accent={owns(game._id.game)}
								class:dark:text-accent-lighter={owns(game._id.game)}
								class:text-gray-500={!owns(game._id.game)}
								class:dark:text-gray-400={!owns(game._id.game)}
							>
								{#if owns(game._id.game)}
									You own this game
								{:else}
									You do not own this game
								{/if}
							</span>
							{#if game.likeCount}
								<span
									class="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400"
									class:text-primary={game.liked}
									class:dark:text-primary-lighter={game.liked}
									title="{game.likeCount} like{game.likeCount === 1 ? '' : 's'}"
								>
									{#if game.liked}
										<IconMeepleFill />
									{:else}
										<IconMeeple />
									{/if}
									{game.likeCount}
								</span>
							{/if}
						</div>
					{/snippet}
				</Card>
			</div>
		{/each}
	</div>
</div>
