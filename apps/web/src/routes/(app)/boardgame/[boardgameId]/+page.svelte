<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import SanitizedHtml from "@/components/SanitizedHtml.svelte";
	import { confirm, handleError } from "@/utils";
	import marked from "marked";
	import type { GameInfoFront } from "@bgs/models";
	import { Button, Card } from "@/modules/cdk";
	import { UserGameSettings, GameList, BoardgameElo, SEO } from "@/components";
	import { account } from "@/lib/account.svelte";
	import { useGameInfos, gameInfoKey } from "@/lib/game-info.svelte";
	import { gamePreferences, useGamePreferencesFallback } from "@/lib/game-preferences.svelte";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { gameLabel } from "@/utils/game-label";
	import { defaultOgImage, ogImageUrl, stripMarkdown, truncate } from "@/lib/seo";
	import type { UserFront } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// The route guarantees the `boardgameId` param is present.
	let boardgameId = $derived(page.params.boardgameId!);
	// Client prefers the account store; SSR falls back to page.data.user.
	let user = $derived(($account ?? page.data.user) as UserFront | null);
	// Game-info list comes from the root-provided context (fetched fresh per request);
	// capture the map at init (getContext) and read from it reactively.
	const infos = useGameInfos();
	let boardgame = $derived(infos[gameInfoKey(boardgameId, "latest")] as GameInfoFront);
	const ssrPrefs = useGamePreferencesFallback();
	let hasOwnership = $derived(($gamePreferences[boardgameId] ?? ssrPrefs[boardgameId])?.access?.ownership);
	let needOwnership = $derived(boardgame?.meta?.needOwnership);

	let rules = $state(false);
	// Placeholder href for the rules/description toggle (click is intercepted).
	const rulesToggleHref = "#";

	async function newGame() {
		if (needOwnership && !hasOwnership) {
			await confirm(
				"You need to have game ownership to host a new game. You can set game ownership in your account settings."
			);
		} else {
			goto(resolve("/(app)/boardgame/[boardgameId]/new-game", { boardgameId }));
		}
	}
</script>

<SEO
	title={gameLabel(boardgame.label)}
	description={truncate(
		stripMarkdown(boardgame.description ?? "") || `Play ${gameLabel(boardgame.label)} online with other people!`,
		200
	)}
	image={ogImageUrl(defaultOgImage.path, {
		title: gameLabel(boardgame.label),
		subtitle: `Play ${gameLabel(boardgame.label)} online with other people!`,
		game: gameLabel(boardgame.label),
	})}
/>

<div class="container mx-auto px-4">
	<h1 class="mb-4">{boardgame.label}</h1>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<div>
			<Card class="border-gray-400 h-full dark:border-gray-600" header={rules ? "Rules" : "Description"}>
				<div class="prose dark:prose-invert max-w-none">
					<SanitizedHtml html={marked((rules ? boardgame.rules : boardgame.description) ?? "")} />
				</div>
				{#snippet footer()}
					<a
						href={rulesToggleHref}
						onclick={(e) => {
							e.preventDefault();
							rules = !rules;
						}}
					>
						{rules ? "See description" : "See rules"}
					</a>
				{/snippet}
			</Card>
		</div>
		<div>
			<UserGameSettings title="Settings" game={boardgame} class="h-full" />
		</div>
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<div class="mt-3">
			<GameList
				{boardgameId}
				gameStatus={user?._id ? (data.myGamesStatus ?? "active") : "active"}
				userId={user?._id}
				perPage={5}
				topRecords
				title={user?._id ? "My games" : "Featured games"}
			/>
		</div>
		<div class="mt-3">
			<GameList sample perPage={5} {boardgameId} gameStatus="open" title="Lobby" />
		</div>
	</div>

	<div class="mt-3 text-center">
		<Button color="accent" href={`/boardgame/${boardgameId}/games` as Pathname} class="text-base">All games</Button>
		<Button color="primary" class="mx-3 text-base" onclick={newGame}>New Game</Button>
		<Button color="accent" href={`/boardgame/${boardgameId}/rankings` as Pathname} class="text-base">Rankings</Button>
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<div class="mt-3">
			<GameList gameStatus="active" {boardgameId} topRecords perPage={5} title="Featured games" />
			<!-- <h3>Tournaments</h3>
      <p> No Tournament info available </p> -->
		</div>
		<div class="mt-3">
			<!-- Todo: show rank of current player if possible with mongodb in an optimized way in the list -->
			<BoardgameElo initial={data.rankings} {boardgameId} top perPage={6} />
		</div>
	</div>
</div>
