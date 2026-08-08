<script lang="ts">
	import { Card, CardText } from "@/modules/cdk";
	import { confirm } from "@/utils";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import ExpandableMarkdown from "@/components/ExpandableMarkdown.svelte";
	import { useLatestGameInfos } from "@/lib/game-info.svelte";
	import { gamePreferences, provideGamePreferences } from "@/lib/game-preferences.svelte";
	import type { IterableElement } from "type-fest";
	import { SEO } from "@/components";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let info = useLatestGameInfos();

	// SSR: provide the SSR-fetched prefs map via context during init so the ownership
	// classes render server-side (setContext must run at init; $effect does NOT run during
	// SSR). On the client the store (seeded by the load's getter) is the reactive source.
	const ssrPreferences = () => data.gamePreferences;
	if (ssrPreferences()) {
		provideGamePreferences(ssrPreferences()!);
	}

	function owns(gameId: string): boolean {
		return !!($gamePreferences[gameId] ?? ssrPreferences()?.[gameId])?.access?.ownership;
	}

	const onClick = async (gameInfo: IterableElement<typeof info>) => {
		if (gameInfo.meta.needOwnership && !owns(gameInfo._id.game)) {
			await confirm(
				"You need to have game ownership to host a new game. You can set game ownership in your account settings."
			);
		} else {
			goto(resolve("/(app)/boardgame/[boardgameId]/new-game", { boardgameId: gameInfo._id.game }));
		}
		return;
	};
</script>

<SEO title="Choose which game to play" description="Play a boardgame of your choice online with other people!" />

<div class="container mx-auto px-4">
	<h1 class="mb-4">Choose which game to play</h1>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		{#each info as game (game._id.game)}
			<div role="button">
				<Card
					header={game.label}
					class="border-gray-300 h-full cursor-pointer transition-shadow hover:border-primary hover:shadow-lg dark:border-gray-600 dark:hover:border-primary-lighter"
					onclick={() => onClick(game)}
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
