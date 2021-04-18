<script lang="ts">
import { latestBoardgames, loadBoardgames } from "@/api";
import { ListGroup, ListGroupItem } from "@/modules/cdk";
import { route, routePath } from "@/modules/router";
import { boardgames } from "@/store";
import { handleError } from "@/utils";
import type { GameInfo } from "@lib/gameinfo";

loadBoardgames().catch(handleError)

let games: GameInfo[]
$: games = latestBoardgames() as GameInfo[], [$boardgames]

function gameRoute(gameId: string) {
  if (gameId === $route!.params.boardgameId) {
    if ($route!.name === "boardgame") {
      return "/refresh-games";
    } else {
      return routePath({
        name: "boardgame",
        params: { boardgameId: gameId },
      });
    }
  }

  if (!$route!.params.boardgameId) {
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
</script>

<ListGroup flush class="d-none d-lg-block ml-n3" style="width: 250px">
  {#each games as game}
    <ListGroupItem
      href={gameRoute(game._id.game)}
      action
      class={$route.params.boardgameId === game._id.game ? "active" : ""}
    >
      <span style="font-weight: 600">{game.label}</span>
    </ListGroupItem>
  {/each}
</ListGroup>
