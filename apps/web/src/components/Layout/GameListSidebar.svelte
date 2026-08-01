<script lang="ts">
  import { page } from "$app/state";
  import { loadGameInfos, gameInfos, latestGameInfos } from "@/lib/game-info.svelte";
  import { logoClick } from "@/lib/stores.svelte";
  import { post } from "@/lib/api";
  import { account } from "@/lib/account.svelte";
  import { handleError } from "@/utils";
  import type { GameInfoFront, UserFront } from "@bgs/models";

  loadGameInfos().catch(handleError);

  // Read synchronously for SSR — the +layout.ts load function already called
  // `await loadGameInfos()` which populated the store before this component renders.
  let games = $state<GameInfoFront[]>(latestGameInfos() as GameInfoFront[]);
  $effect(() => {
    $gameInfos;
    games = latestGameInfos() as GameInfoFront[];
  });
  let boardgameId = $derived(page!.params.boardgameId);

  // Boardgames the player has played (open/active/ended), floated to the top and
  // ordered by most recent activity. Loaded in the root +layout.ts so SSR renders
  // the pinned group immediately (no post-hydration pop-in).
  let myBoardgames = $derived((page.data.myBoardgames ?? []) as string[]);

  // "Forgotten" boardgames: hidden from the pinned "My games" group but still shown
  // in "All games". Stored on the user's account settings (DB-backed, syncs across
  // devices); the server clears a game's flag when the player joins or creates a
  // game of it, re-pinning it automatically. Read from the SSR-loaded user
  // (page.data.user) so hidden games stay hidden during SSR; fall back to the live
  // account store so a forget/unforget updates the list without a reload.
  let forgotten = $derived((($account ?? page.data.user)?.settings?.home?.forgottenGames ?? []) as string[]);
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

  const byLabel = (a: GameInfoFront, b: GameInfoFront) => a.label.localeCompare(b.label);
  const rank = (id: string) => {
    const i = myBoardgames.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  let pinnedIds = $derived(myBoardgames.filter((id) => !forgotten.includes(id)));
  let topGames = $derived(
    games.filter((g) => pinnedIds.includes(g._id.game)).sort((a, b) => rank(a._id.game) - rank(b._id.game))
  );
  let otherGames = $derived(games.filter((g) => !pinnedIds.includes(g._id.game)).sort(byLabel));

  function gameRoute(gameId: string) {
    if (!boardgameId) {
      return `/boardgame/${gameId}${page.url.pathname}`;
    }

    if (gameId === boardgameId) {
      if (page.url.pathname === "/boardgame/" + gameId) {
        return "/refresh-games";
      } else {
        return "/boardgame/" + gameId;
      }
    }

    return page.url.pathname.replace(`/boardgame/${boardgameId}`, `/boardgame/${gameId}`) + page.url.search;
  }

  function handleClick(event: MouseEvent & { currentTarget: HTMLAnchorElement }) {
    if (event.currentTarget.attributes.getNamedItem("href")!.value === "/refresh-games") {
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
      href={gameRoute(id)}
      class:bg-primary={boardgameId === id}
      class:text-white={boardgameId === id}
      data-sveltekit-preload-data="hover"
      onclick={handleClick}
    >
      {game.label}
      {#if isForgotten}
        <span class="ms-1 text-xs font-normal text-gray-400">(hidden)</span>
      {/if}
    </a>
    {#if pinned}
      <button
        type="button"
        title="Remove from My games (still listed under All games)"
        aria-label={`Forget ${game.label}`}
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
        aria-label={`Unforget ${game.label}`}
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
      {#each topGames as game}
        {@render gameItem(game, true)}
      {/each}
      <li class="px-4 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        All games
      </li>
    {/if}
    {#each otherGames as game}
      {@render gameItem(game, false)}
    {/each}
  {/key}
</ul>
