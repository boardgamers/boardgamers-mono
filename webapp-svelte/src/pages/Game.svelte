<script context="module">

import type {Writable} from 'svelte/store'

export type GameContext = {
  game: Writable<IGame>,
  players: Writable<PlayerInfo[]>,
  gameInfo: Writable<GameInfo>
  replayData: Writable<{ start: number; end: number; current: number } | null>,
  emitter: EventEmitter,
  log: Writable<string[]>
}

</script>

<script lang="ts">
import { boardgameInfo, loadBoardgame } from "@/api";

import { loadGame } from "@/api/game";

import { GameSidebar, OpenGame, StartedGame, ChatRoom } from "@/components"
import { Loading } from "@/modules/cdk"
import { currentGameId, currentRoom } from "@/store";
import { defer } from "@/utils";
import type { IGame, PlayerInfo } from "@lib/game";
import { loadGameSettings } from "@/api/gamesettings";
import { onDestroy, setContext } from "svelte";
import { writable } from "svelte/store";
import type { GameInfo } from "@lib/gameinfo";
import EventEmitter from "eventemitter3";

export let gameId: string;

const context = {
  game: writable<IGame | null>(null),
  players: writable<PlayerInfo[]>([]),
  gameInfo: writable<GameInfo | null>(null),
  replayData: writable<{ start: number; end: number; current: number } | null>(null),
  emitter: new EventEmitter(),
  log: writable<string[]>([])
}

setContext('game', context)

const {game, players, gameInfo, replayData, log} = context;

const load = defer(async () => {
  currentGameId.set(gameId)
  currentRoom.set(gameId)

  // Reset game on gameId change
  if ($game !== null && $game._id !== gameId) {
    $game = null;
    $gameInfo = null;
    $players = [];
    $replayData = null
    $log = []
  }
  // Load new game
  const {game: g, players: p} = await loadGame(gameId)
  if (g._id !== gameId) {
    return;
  }
  await Promise.all([
    loadBoardgame(g.game.name, g.game.version),
    loadGameSettings(g.game.name)
  ])

  $game = g;
  $players = p;
  $gameInfo = boardgameInfo($game!.game.name, $game!.game.version) as GameInfo
});

$: load(), [gameId]

onDestroy(() => {
  currentGameId.set(null);
  currentRoom.set(null);
})
</script>

<svelte:head>
  <title>{gameId} - Boardgamers 🌌</title>
</svelte:head>

<Loading loading={!$game || !$gameInfo}>
  {#if $game.status === "open" || $game.status === "pending"}
    <OpenGame />
  {:else}
    <StartedGame />
  {/if}
  <ChatRoom room={gameId} />
  <GameSidebar />
</Loading>
