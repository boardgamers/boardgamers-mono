<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import SanitizedHtml from "@/components/SanitizedHtml.svelte";
	import { confirm, handleError } from "@/utils";
	import marked from "marked";
	import type { GameFront, GameInfoFront } from "@bgs/models";
	import { Button, Card } from "@/modules/cdk";
	import {
		UserGameSettings,
		GameList,
		BoardgameElo,
		BoardgameLinks,
		BoardgameRequests,
		GameName,
		GameLikeButton,
		SetupOptionsFilter,
	} from "@/components";
	import { account } from "@/lib/account.svelte";
	import { live } from "@/lib/stores.svelte";
	import { useGameInfos, gameInfoKey, applyGameLike, patchGameInfosLike } from "@/lib/game-info.svelte";
	import { gamePreferences, useGamePreferencesFallback } from "@/lib/game-preferences.svelte";
	import { page } from "$app/state";
	import { goto, replaceState } from "$app/navigation";
	import { browser } from "$app/environment";
	import { untrack } from "svelte";
	import type { GamePace } from "@/utils";
	import { peekGames, gameListParams, type SetupOptionFilter } from "@/lib/games.svelte";
	import type { UserFront } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// The route guarantees the `boardgameId` param is present.
	let boardgameId = $derived(page.params.boardgameId!);
	// SSR renders the snapshot; the client trusts the seeded account store (see stores.svelte.ts).
	let user = $derived(live($account, (page.data.user as UserFront | null) ?? null));
	// Game-info list comes from the root-provided context: a reactive `$state` map. Reading
	// it inside `$derived` tracks the like fields, so a toggle updates this page's header.
	const infos = useGameInfos();
	let boardgame = $derived(infos[gameInfoKey(boardgameId, "latest")] as GameInfoFront);
	function onLikeToggle(next: { liked: boolean; likeCount: number }) {
		// Mutate the shared reactive map in place: every consumer (this header, the sidebar
		// badge, the catalog) re-renders, and the value survives client-side navigation (the
		// context is seeded once, not per page). Also patch the browser store (getGameInfo's
		// viewer cache) so non-context readers stay consistent.
		Object.assign(infos, applyGameLike(infos, boardgameId, next));
		patchGameInfosLike(boardgameId, next);
	}
	const ssrPrefs = useGamePreferencesFallback();
	let hasOwnership = $derived(($gamePreferences[boardgameId] ?? ssrPrefs[boardgameId])?.access?.ownership);
	let needOwnership = $derived(boardgame?.needOwnership);

	let rules = $state(false);
	// Placeholder href for the rules/description toggle (click is intercepted).
	const rulesToggleHref = "#";

	// Lobby filters (#55): pace plus this game's setup options (map / variant / …).
	// Pace initializes from ?pace= so a shared link restores the filter.
	const initialPace = page.url.searchParams.get("pace");
	let lobbyPace = $state<"" | GamePace>(initialPace === "live" || initialPace === "async" ? initialPace : "");
	let lobbyOptions = $state<SetupOptionFilter | undefined>(undefined);
	let lobbyPaceFilter = $derived<GamePace | undefined>(lobbyPace === "" ? undefined : lobbyPace);
	// Reflect the pace filter in the URL without a history entry or a navigation.
	$effect(() => {
		if (!browser) {
			return;
		}
		const url = new URL(page.url);
		if (lobbyPace === "") {
			url.searchParams.delete("pace");
		} else {
			url.searchParams.set("pace", lobbyPace);
		}
		if (url.href !== page.url.href) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- only the query string changes; the pathname is already the current route
			replaceState(url, page.state);
		}
	});
	// The lobby's loaded open games. Seeded once (untrack) from the +page.ts prefetch
	// cache so the SSR render (where the child's bind-back hasn't run yet) derives the
	// same filter choices as hydration.
	let lobbyGames = $state<GameFront[]>(
		untrack(
			() =>
				peekGames(gameListParams({ gameStatus: "open", boardgameId, perPage: 5, viewerKarma: user?.account?.karma }))
					?.games ?? []
		)
	);
	// The last lobby list fetched WITHOUT a pace filter — what the filter's chips
	// (pace visibility + option groups) derive from. Anchoring to the unfiltered set
	// keeps the chips rendered after filtering narrows the list to a single pace (or
	// to nothing), which is exactly when the user needs them to switch back.
	let unfilteredLobbyGames = $state<GameFront[]>(untrack(() => lobbyGames));
	$effect(() => {
		if (lobbyPaceFilter === undefined) {
			unfilteredLobbyGames = lobbyGames;
		}
	});

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

<div class="container mx-auto px-4">
	<h1 class="mb-4 flex items-center gap-3">
		<GameName info={boardgame} />
		{#if boardgame}
			<GameLikeButton
				gameId={boardgameId}
				liked={!!boardgame.liked}
				likeCount={boardgame.likeCount ?? 0}
				onlike={onLikeToggle}
				ssrUser={user}
			/>
		{/if}
	</h1>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<div>
			<Card class="border-gray-400 h-full dark:border-gray-600">
				{#snippet headerContent()}
					<div class="flex items-center">
						<span class="flex-1"></span>
						<span class="font-semibold">{rules ? "Rules" : "Description"}</span>
						<span class="flex flex-1 justify-end">
							<BoardgameLinks links={boardgame.links} />
						</span>
					</div>
				{/snippet}
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
			<!-- Not `sample`: one boardgame's open games are a small set, and a setup-options
			     filter must see every match (sampling would hide same-creator games). -->
			<GameList
				perPage={5}
				{boardgameId}
				gameStatus="open"
				title="Lobby"
				pace={lobbyPaceFilter}
				optionFilter={lobbyOptions}
				viewerKarma={user?.account?.karma}
				bind:games={lobbyGames}
			>
				{#snippet headerContent()}
					<SetupOptionsFilter
						info={boardgame}
						games={unfilteredLobbyGames}
						bind:pace={lobbyPace}
						bind:optionFilter={lobbyOptions}
					/>
				{/snippet}
			</GameList>
		</div>
	</div>

	<div class="mt-3 text-center">
		<Button color="accent" href={`/boardgame/${boardgameId}/games` as Pathname} class="text-base">All games</Button>
		<Button color="primary" class="mx-3 text-base" onclick={newGame}>New Game</Button>
		<Button color="accent" href={`/boardgame/${boardgameId}/rankings` as Pathname} class="text-base">Rankings</Button>
	</div>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<div class="mt-3">
			<GameList
				gameStatus={data.featuredStatus ?? "active"}
				{boardgameId}
				topRecords
				perPage={5}
				title={data.featuredStatus === "ended" ? "Recently finished" : "Featured games"}
			/>
			<!-- <h3>Tournaments</h3>
      <p> No Tournament info available </p> -->
		</div>
		<div class="mt-3">
			<!-- Todo: show rank of current player if possible with mongodb in an optimized way in the list -->
			<BoardgameElo initial={data.rankings} {boardgameId} top perPage={6} />
		</div>
	</div>

	<div class="grid grid-cols-1 gap-x-4 lg:grid-cols-2">
		<BoardgameRequests
			{boardgameId}
			sourceUrl={boardgame?.links?.source}
			requests={data.gameRequests}
			{user}
			class={boardgame?.credits ? "" : "lg:col-span-2"}
		/>
		{#if boardgame?.credits}
			<section class="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
				<h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Credits</h2>
				<div class="prose prose-sm dark:prose-invert max-w-none text-gray-600 dark:text-gray-300">
					<SanitizedHtml html={marked(boardgame.credits)} />
				</div>
			</section>
		{/if}
	</div>
</div>
