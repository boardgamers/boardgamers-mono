<script lang="ts">
	import { untrack } from "svelte";
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import { page } from "$app/state";
	import { byGamePopularity, byMyGamesOrder, useLatestGameInfos } from "@/lib/game-info.svelte";
	import { logoClick } from "@/lib/stores.svelte";
	import { post } from "@/lib/api";
	import { account } from "@/lib/account.svelte";
	import { live, likedBoardgames } from "@/lib/stores.svelte";
	import { handleError } from "@/utils";
	import { gameDisplayName } from "@/utils/game-label";
	import GameName from "@/components/GameName.svelte";
	import IconMeeple from "@/components/icons/IconMeeple.svelte";
	import IconMeepleFill from "@/components/icons/IconMeepleFill.svelte";
	import type { GameInfoFront, UserFront } from "@bgs/models";
	import type { GameInfoMap } from "@/lib/game-info.svelte";

	// Test-only injection point: specs pass the game-info map as a prop (setContext must
	// run during component init, so a spec can't provide it post-hoc). Production leaves
	// it undefined and the root layout's context map is used.
	let { gameInfos: gameInfosProp }: { gameInfos?: GameInfoMap } = $props();

	// A `$state` COPY of the game-info map's `/latest` entries, keyed by game. The source
	// map's values are plain objects (mutated in place by like toggles — untracked), so
	// reads here wouldn't re-run; seeding keyed `$state` entries makes `liked`/`likeCount`
	// (and a like toggle's propagation) reactive in the derivations below. The prop is a
	// keyed map (test injection), the context fallback a `/latest` list — normalize both.
	// `untrack`: the seed is intentionally the initial snapshot, read once at init.
	const sourceInfos: GameInfoFront[] = untrack(() =>
		gameInfosProp
			? Object.keys(gameInfosProp)
					.filter((key) => key.endsWith("/latest"))
					.map((key) => gameInfosProp[key] as GameInfoFront)
			: (useLatestGameInfos() as GameInfoFront[])
	);
	const gameById = $state<Record<string, GameInfoFront>>({});
	for (const info of sourceInfos) {
		const id = info._id.game;
		gameById[id] ??= info as GameInfoFront;
	}
	let games = $derived(Object.values(gameById));
	let boardgameId = $derived(page!.params.boardgameId);

	// Boardgames the player has played (open/active/ended) or liked — the "My games"
	// membership. Loaded in the root +layout.ts so SSR renders the group immediately
	// (no post-hydration pop-in). Each row carries the two freshness signals:
	// `lastPlayedAt` (raw play recency) and `likedAt` (like recency).
	type MyBoardgameRow = { boardgame: string; lastPlayedAt?: string; liked?: boolean; likedAt?: string };
	let myBoardgameRows = $derived((page.data.myBoardgames ?? []) as MyBoardgameRow[]);
	let playedIds = $derived(myBoardgameRows.map((r) => r.boardgame));

	// Play-recency timestamps, game → ms (from the SSR rows; play activity doesn't
	// change client-side without a reload, so no live store is needed).
	let lastPlayedAtMs = $derived(
		Object.fromEntries(
			myBoardgameRows.flatMap((r) => (r.lastPlayedAt ? [[r.boardgame, Date.parse(r.lastPlayedAt)]] : []))
		)
	);

	// Like timestamps, game → ms. SSR renders the rows' snapshot; the client trusts the
	// seeded store (live()), which tracks toggles — a like stamps `now`, refreshing the
	// game's position in "My games" without a reload.
	let likedAtMs = $derived(
		live(
			$likedBoardgames,
			Object.fromEntries(myBoardgameRows.flatMap((r) => (r.likedAt ? [[r.boardgame, Date.parse(r.likedAt)]] : [])))
		)
	);

	// "Forgotten" boardgames: hidden from the pinned "My games" group but still shown
	// in "All games". Stored on the user's account settings (DB-backed, syncs across
	// devices); the server clears a game's flag when the player joins or creates a
	// game of it, re-pinning it automatically. SSR renders the snapshot so hidden games
	// stay hidden on first paint; the client trusts the seeded account store so a
	// forget/unforget updates the list without a reload (see stores.svelte.ts).
	let forgotten = $derived(
		(live($account, (page.data.user as UserFront | null) ?? null)?.settings?.home?.forgottenGames ?? []) as string[]
	);
	function saveForgotten(next: string[]) {
		post<UserFront>("/account", { settings: { home: { forgottenGames: next } } })
			.then((updated) => account.set(updated))
			.catch(handleError);
	}
	function forget(id: string) {
		saveForgotten([...forgotten, id]);
	}
	function unforget(id: string) {
		saveForgotten(forgotten.filter((g) => g !== id));
	}

	let pinnedIds = $derived(playedIds.filter((id) => !forgotten.includes(id)));
	// "My games" = games the player has played (pinned) ∪ games they liked, "freshest
	// first": each game's sort key is the MOST RECENT of its last-played and like times
	// (byMyGamesOrder). A liked game belongs here by construction — liking one moves it
	// in automatically (no imperative add), and unliking a never-played game drops it
	// back out. Membership reads the reactive `likedAtMs` (not `g.liked`, an untracked
	// plain field) so a like toggle updates the sidebar live; the seed covers every
	// SSR'd like, so the two agree on first paint.
	let topGames = $derived(
		games
			.filter((g) => pinnedIds.includes(g._id.game) || likedAtMs[g._id.game] !== undefined)
			.sort(byMyGamesOrder(lastPlayedAtMs, likedAtMs))
	);
	let topIds = $derived(new Set(topGames.map((g) => g._id.game)));
	// "All games" = everything not already in "My games", most-liked first (display name
	// breaks ties). Liked games are in "My games", so they neither double-show nor jump
	// to the top here — the liked-first term of byGamePopularity is a no-op on this set.
	let otherGames = $derived(games.filter((g) => !topIds.has(g._id.game)).sort(byGamePopularity));

	const refreshGamesRoute = "/refresh-games";

	function gameRoute(gameId: string): Pathname {
		if (!boardgameId) {
			// Same page, but for another boardgame: swap the boardgame id into the current path.
			return `/boardgame/${gameId}${page.url.pathname}` as Pathname;
		}

		if (gameId === boardgameId) {
			if (page.url.pathname === "/boardgame/" + gameId) {
				// Not a real route: clicking the active game on its own page re-triggers the logo click.
				return refreshGamesRoute as Pathname;
			} else {
				return `/boardgame/${gameId}` as Pathname;
			}
		}

		return (page.url.pathname.replace(`/boardgame/${boardgameId}`, `/boardgame/${gameId}`) +
			page.url.search) as Pathname;
	}

	function handleClick(event: MouseEvent & { currentTarget: HTMLAnchorElement }) {
		if (event.currentTarget.attributes.getNamedItem("href")!.value === refreshGamesRoute) {
			event.preventDefault();
			logoClick();
		}
	}
</script>

{#snippet gameItem({ game, pinned }: { game: GameInfoFront; pinned: boolean })}
	{@const id = game._id.game}
	{@const isForgotten = forgotten.includes(id)}
	<!-- ✕ "forget" applies only to a game pinned by play (in myBoardgames) that isn't
	     already forgotten. A liked game stays in "My games" via the like even when
	     forgotten, and a liked-never-played game has no play-pin to forget — so ✕ would
	     be a no-op on those; forgotten games show ↩ (unforget) instead. -->
	{@const canForget = pinned && !isForgotten && playedIds.includes(id)}
	<li class="group relative">
		<a
			class="block px-4 py-2 font-semibold no-underline text-inherit hover:bg-gray-100 dark:hover:bg-gray-800"
			href={resolve(...([gameRoute(id)] as Parameters<typeof resolve>))}
			class:bg-primary={boardgameId === id}
			class:text-white={boardgameId === id}
			data-sveltekit-preload-data="hover"
			onclick={handleClick}
		>
			<div class="flex items-baseline">
				<div class="min-w-0 flex-1">
					<GameName info={game} />
				</div>
				{#if isForgotten}
					<span class="ms-1 shrink-0 self-center text-xs font-normal text-gray-400">(hidden)</span>
				{/if}
				{#if game.likeCount}
					<span
						class="ms-1 flex shrink-0 items-center gap-0.5 self-center text-xs font-normal text-gray-400 dark:text-gray-500"
						class:text-primary={game.liked}
						class:dark:text-primary-lighter={game.liked}
						title="{game.likeCount} like{game.likeCount === 1 ? '' : 's'}"
					>
						{#if game.liked}
							<IconMeepleFill size="0.75em" />
						{:else}
							<IconMeeple size="0.75em" />
						{/if}
						{game.likeCount}
					</span>
				{/if}
			</div>
		</a>
		{#if canForget}
			<button
				type="button"
				title="Remove from My games (still listed under All games)"
				aria-label={`Forget ${gameDisplayName(game)}`}
				class="absolute end-1 top-1/2 hidden -translate-y-1/2 rounded px-1.5 py-0.5 text-gray-400 hover:bg-black/10 hover:text-gray-700 group-hover:block dark:hover:bg-white/10 dark:hover:text-gray-200"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					forget(id);
				}}
			>
				✕
			</button>
		{:else if isForgotten}
			<button
				type="button"
				title="Pin back to My games"
				aria-label={`Unforget ${gameDisplayName(game)}`}
				class="absolute end-1 top-1/2 hidden -translate-y-1/2 rounded px-1.5 py-0.5 text-gray-400 hover:bg-black/10 hover:text-gray-700 group-hover:block dark:hover:bg-white/10 dark:hover:text-gray-200"
				onclick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					unforget(id);
				}}
			>
				↩
			</button>
		{/if}
	</li>
{/snippet}

<ul class="hidden w-[250px] shrink-0 divide-y divide-gray-200 dark:divide-gray-700 lg:block">
	{#key boardgameId}
		{#if topGames.length > 0}
			<li class="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">My games</li>
			{#each topGames as game (game._id.game)}
				{@render gameItem({ game, pinned: true })}
			{/each}
			<li class="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
				All games
			</li>
		{/if}
		{#each otherGames as game (game._id.game)}
			{@render gameItem({ game, pinned: false })}
		{/each}
	{/key}
	<li>
		<a
			class="block px-4 py-2 font-semibold no-underline text-inherit hover:bg-gray-100 dark:hover:bg-gray-800"
			href={resolve("/(app)/feedback#game-requests")}
		>
			Suggest a game
		</a>
	</li>
</ul>
