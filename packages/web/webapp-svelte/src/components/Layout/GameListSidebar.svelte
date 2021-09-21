<script lang="ts">
  import { latestBoardgames, loadBoardgames } from "@/api";
  import { ListGroup } from "@/modules/cdk";
  import { route, routePath } from "@/modules/router";
  import { boardgames, logoClicks } from "@/store";
  import { handleError } from "@/utils";
  import type { GameInfo } from "@bgs/types/gameinfo";

  loadBoardgames().catch(handleError);

  let games: GameInfo[];
  $: (games = latestBoardgames() as GameInfo[]), [$boardgames];
  $: boardgameId = $route!.params.boardgameId;

  function gameRoute(gameId: string) {
    if (gameId === boardgameId) {
      if ($route!.name === "boardgame") {
        return "/refresh-games";
      } else {
        return routePath({
          name: "boardgame",
          params: { boardgameId: gameId },
        });
      }
    }

    if (!boardgameId) {
      return routePath({
        name: "boardgame",
        params: { boardgameId: gameId },
      });
    }

    return routePath({
      name: $route!.name,
      hash: $route!.hash,
      params: { ...$route!.params, boardgameId: gameId },
    });
  }

  function handleClick(event: MouseEvent & { currentTarget: HTMLAnchorElement }) {
    if (event.currentTarget.attributes.getNamedItem("href")!.value === "/refresh-games") {
      event.preventDefault();
      logoClicks.update((v) => v + 1);
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
        on:click={handleClick}
        style="font-weight: 600"
      >
        {game.label}
      </a>
    {/each}
  {/key}
</ListGroup>
