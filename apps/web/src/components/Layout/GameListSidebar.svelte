<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import { page } from "$app/state";
	import { useLatestGameInfos } from "@/lib/game-info.svelte";
	import { logoClick } from "@/lib/stores.svelte";
	import { post } from "@/lib/api";
	import { account } from "@/lib/account.svelte";
	import { live } from "@/lib/stores.svelte";
	import { handleError } from "@/utils";
	import { gameDisplayName } from "@/utils/game-label";
	import GameName from "@/components/GameName.svelte";
	import IconHeartFill from "@/components/icons/IconHeartFill.svelte";
	import type { GameInfoFront, UserFront } from "@bgs/models";

	const games = useLatestGameInfos() as GameInfoFront[];
	let boardgameId = $derived(page!.params.boardgameId);

	// Boardgames the player has played (open/active/ended), floated to the top and
	// ordered by most recent activity. Loaded in the root +layout.ts so SSR renders
	// the pinned group immediately (no post-hydration pop-in).
	let myBoardgames = $derived((page.data.myBoardgames ?? []) as string[]);

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

	// Sort by the DISPLAYED name (alias when set) so the ordering matches what the player reads.
	const byLabel = (a: GameInfoFront, b: GameInfoFront) => gameDisplayName(a).localeCompare(gameDisplayName(b));
	// Discovery ordering (#98): most liked first, display name breaks ties.
	const byPopularity = (a: GameInfoFront, b: GameInfoFront) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || byLabel(a, b);
	const rank = (id: string) => {
		const i = myBoardgames.indexOf(id);
		return i === -1 ? Number.MAX_SAFE_INTEGER : i;
	};
	let pinnedIds = $derived(myBoardgames.filter((id) => !forgotten.includes(id)));
	let topGames = $derived(
		games.filter((g) => pinnedIds.includes(g._id.game)).sort((a, b) => rank(a._id.game) - rank(b._id.game))
	);
	let otherGames = $derived(games.filter((g) => !pinnedIds.includes(g._id.game)).sort(byPopularity));

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

{#snippet gameItem(game: GameInfoFront, pinned: boolean)}
	{@const id = game._id.game}
	{@const isForgotten = forgotten.includes(id)}
	<li class="group relative">
		<a
			class="block px-4 py-2 font-semibold no-underline text-inherit hover:bg-gray-100 dark:hover:bg-gray-800"
			href={resolve(...([gameRoute(id)] as Parameters<typeof resolve>))}
			class:bg-primary={boardgameId === id}
			class:text-white={boardgameId === id}
			data-sveltekit-preload-data="hover"
			onclick={handleClick}
		>
			<GameName info={game} />
			{#if isForgotten}
				<span class="ms-1 text-xs font-normal text-gray-400">(hidden)</span>
			{/if}
			{#if game.likeCount}
				<span
					class="ms-1 inline-flex items-center gap-0.5 align-baseline text-xs font-normal text-gray-400 dark:text-gray-500"
					class:text-red-500={game.liked}
					class:dark:text-red-400={game.liked}
					title="{game.likeCount} like{game.likeCount === 1 ? '' : 's'}"
				>
					<IconHeartFill size="0.75em" />
					{game.likeCount}
				</span>
			{/if}
		</a>
		{#if pinned}
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
			{#each topGames as game (game._id.game)}
				{@render gameItem(game, true)}
			{/each}
			<li class="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
				All games
			</li>
		{/if}
		{#each otherGames as game (game._id.game)}
			{@render gameItem(game, false)}
		{/each}
	{/key}
</ul>
