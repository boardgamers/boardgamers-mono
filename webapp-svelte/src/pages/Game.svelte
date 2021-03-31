<script lang="ts">
import { boardgameKey, loadBoardgame } from "@/api";

import { loadGame } from "@/api/game";

import OpenGame from "@/components/OpenGame.svelte"
import GameSidebar from "@/components/GameSidebar.svelte"
import StartedGame from "@/components/StartedGame.svelte"
import Loading from "@/modules/cdk/Loading.svelte"
import { boardgames } from "@/store";
import { defer } from "@/utils";
import type { IGame, PlayerInfo } from "@lib/game";
import { loadGameSettings } from "@/api/gamesettings";

export let gameId: string;
let game: IGame | null = null;
let players: PlayerInfo[] = [];

const load = defer(async () => {
  // Reset game on gameId change
  if (game !== null && game?._id !== gameId) {
    game = null;
    players = [];
  }
  // Load new game
  const {game: g, players: p} = await loadGame(gameId)
  if (g._id !== gameId) {
    return;
  }
  game = g;
  players = p;
  await Promise.all([
    loadBoardgame(game!.game.name, game!.game.version),
    loadGameSettings(game!.game.name)
  ])
});

$: load(), [gameId]
</script>

<Loading loading={!game || !$boardgames[boardgameKey(game.game.name, game.game.version)]?.viewer}>
  {#if game.status === "open" || game.status === "pending"}
    <OpenGame {game} {players} />
  {:else}
    <StartedGame {game} {players} />
  {/if}
  <GameSidebar {game} {players} />
</Loading>
