<script lang="ts">
  import { page } from "$app/stores";
  import { loadGameInfos, gameInfos, latestGameInfos } from "@/lib/game-info.svelte";
  import { logoClick } from "@/lib/stores.svelte";
  import { ListGroup } from "@/modules/cdk";
  import { handleError } from "@/utils";
  import type { GameInfo } from "@bgs/models";

  loadGameInfos().catch(handleError);

  let games: GameInfo[];
  $: ((games = latestGameInfos() as GameInfo[]), [$gameInfos]);
  $: boardgameId = $page!.params.boardgameId;

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

<ListGroup flush class="d-none d-lg-block ms-n3" style="width: 250px">
  {#key boardgameId}
    {#each games as game}
      <a
        class="list-group-item-action list-group-item"
        href={gameRoute(game._id.game)}
        class:active={boardgameId === game._id.game}
        data-sveltekit-preload-data="hover"
        on:click={handleClick}
        style="font-weight: 600"
      >
        {game.label}
      </a>
    {/each}
  {/key}
</ListGroup>
