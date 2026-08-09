<script lang="ts">
	import { Card, CardText } from "@/modules/cdk";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import ExpandableMarkdown from "@/components/ExpandableMarkdown.svelte";
	import { useLatestGameInfos } from "@/lib/game-info.svelte";
	import { gamePreferences, provideGamePreferences } from "@/lib/game-preferences.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let info = useLatestGameInfos();

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
	<h1 class="mb-4">Game selection</h1>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		{#each info as game (game._id.game)}
			<div>
				<Card
					header={game.label}
					class="border-gray-300 h-full cursor-pointer transition-shadow hover:border-primary hover:shadow-lg dark:border-gray-600 dark:hover:border-primary-lighter"
					onclick={() => goto(resolve("/(app)/boardgame/[boardgameId]", { boardgameId: game._id.game }))}
					role="button"
				>
					<CardText>
						<ExpandableMarkdown markdown={game.description} />
					</CardText>
					{#snippet footer()}
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
					{/snippet}
				</Card>
			</div>
		{/each}
	</div>
</div>
