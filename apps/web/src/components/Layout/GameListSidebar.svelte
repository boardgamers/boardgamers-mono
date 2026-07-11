<script lang="ts">
  import { page } from "$app/stores";
  import { loadGameInfos, gameInfos, latestGameInfos } from "@/lib/game-info.svelte";
  import { logoClick } from "@/lib/stores.svelte";
  import { handleError } from "@/utils";
  import type { GameInfoFront } from "@bgs/models";

  loadGameInfos().catch(handleError);

  let games = $state<GameInfoFront[]>([]);
  $effect(() => {
    $gameInfos;
    games = latestGameInfos() as GameInfoFront[];
  });
  let boardgameId = $derived($page!.params.boardgameId);

  function gameRoute(gameId: string) {
    if (!boardgameId) {
      return `/boardgame/${gameId}${$page.url.pathname}`;
    }

    if (gameId === boardgameId) {
      if ($page.url.pathname === "/boardgame/" + gameId) {
        return "/refresh-games";
      } else {
        return "/boardgame/" + gameId;
      }
    }

    return $page.url.pathname.replace(`/boardgame/${boardgameId}`, `/boardgame/${gameId}`) + $page.url.search;
  }

  function handleClick(event: MouseEvent & { currentTarget: HTMLAnchorElement }) {
    if (event.currentTarget.attributes.getNamedItem("href")!.value === "/refresh-games") {
      event.preventDefault();
      logoClick();
    }
  }
</script>

<ul class="hidden w-[250px] -ml-4 divide-y divide-gray-200 dark:divide-gray-700 lg:block">
  {#key boardgameId}
    {#each games as game}
      <a
        class="block px-4 py-2 font-semibold no-underline text-inherit hover:bg-gray-100 dark:hover:bg-gray-800"
        href={gameRoute(game._id.game)}
        class:bg-primary={boardgameId === game._id.game}
        class:text-white={boardgameId === game._id.game}
        data-sveltekit-preload-data="hover"
        onclick={handleClick}
      >
        {game.label}
      </a>
    {/each}
  {/key}
</ul>
