<script lang="ts">
	import { Card, CardText } from "@/modules/cdk";
	import { confirm } from "@/utils";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import ExpandableMarkdown from "@/components/ExpandableMarkdown.svelte";
	import GameLikeButton from "@/components/GameLikeButton.svelte";
	import {
		byGamePopularity,
		useLatestGameInfos,
		useGameInfos,
		applyGameLike,
		patchGameInfosLike,
	} from "@/lib/game-info.svelte";
	import { account } from "@/lib/account.svelte";
	import { live } from "@/lib/stores.svelte";
	import { gamePreferences, provideGamePreferences } from "@/lib/game-preferences.svelte";
	import { gameBasedOnLabel, gameDisplayName } from "@/utils/game-label";
	import type { IterableElement } from "type-fest";
	import type { UserFront } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// Same discovery ordering as /boardgames (#98): my likes first, then most liked.
	let info = $derived.by(() => useLatestGameInfos().slice().sort(byGamePopularity));

	// SSR renders the snapshot; the client trusts the seeded account store (live()).
	let user = $derived(live($account, (page.data.user as UserFront | null) ?? null));
	// The reactive game-info map, so a like toggle propagates to every consumer (this
	// list, the sidebar, the catalog) and survives client-side navigation.
	const infos = useGameInfos();
	function onLikeToggle(gameId: string, next: { liked: boolean; likeCount: number }) {
		Object.assign(infos, applyGameLike(infos, gameId, next));
		patchGameInfosLike(gameId, next);
	}

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
		if (gameInfo.needOwnership && !owns(gameInfo._id.game)) {
			await confirm(
				"You need to have game ownership to host a new game. You can set game ownership in your account settings."
			);
		} else {
			goto(resolve("/(app)/boardgame/[boardgameId]/new-game", { boardgameId: gameInfo._id.game }));
		}
		return;
	};
</script>

<div class="container mx-auto px-4">
	<h1 class="mb-4">Choose which game to play</h1>
	<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
		Missing a game? <a href={resolve("/(app)/feedback#game-requests")}>Suggest it</a>
	</p>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
		{#each info as game (game._id.game)}
			<div role="button">
				<Card
					header={gameDisplayName(game)}
					class="border-gray-300 h-full cursor-pointer transition-shadow hover:border-primary hover:shadow-lg dark:border-gray-600 dark:hover:border-primary-lighter"
					onclick={() => onClick(game)}
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
							<GameLikeButton
								gameId={game._id.game}
								liked={!!game.liked}
								likeCount={game.likeCount ?? 0}
								onlike={(next) => onLikeToggle(game._id.game, next)}
								ssrUser={user}
							/>
						</div>
					{/snippet}
				</Card>
			</div>
		{/each}
	</div>
</div>
