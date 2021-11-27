<script context="module" lang="ts">
  import type { Writable } from "svelte/store";
  import type { LoadInput } from "@sveltejs/kit";
  import { boardgameInfo, loadBoardgame, loadGamePlayers, loadGameData } from "@/api";

  export type GameContext = {
    game: Writable<IGame>;
    players: Writable<PlayerInfo[]>;
    gameInfo: Writable<GameInfo>;
    replayData: Writable<{ start: number; end: number; current: number } | null>;
    emitter: EventEmitter;
    log: Writable<string[]>;
  };

  export async function load(input: LoadInput) {
    const gameId = input.page.params.gameId;

    const [game, players] = await Promise.all([loadGameData(gameId), loadGamePlayers(gameId)]);
    await loadBoardgame(game.game.name, game.game.version);

    return {
      props: {
        game,
        players,
        gameInfo: boardgameInfo(game.game.name, game.game.version),
      },
    };
  }
</script>

<script lang="ts">
  import { GameSidebar, OpenGame, StartedGame, ChatRoom } from "@/components";
  import { currentGameId, currentRoom } from "@/store";
  import type { IGame, PlayerInfo, GameInfo } from "@bgs/types";
  import { onDestroy, setContext } from "svelte";
  import { writable } from "svelte/store";
  import EventEmitter from "eventemitter3";

  export let game: IGame;
  export let players: PlayerInfo[];
  export let gameInfo: GameInfo;

  $: gameId = game._id;
  $: currentGameId.set(gameId);
  $: currentRoom.set(gameId);

  const context = {
    game: writable<IGame | null>(null),
    players: writable<PlayerInfo[]>([]),
    gameInfo: writable<GameInfo | null>(null),
    replayData: writable<{ start: number; end: number; current: number } | null>(null),
    emitter: new EventEmitter(),
    log: writable<string[]>([]),
  };

  setContext("game", context);

  $: {
    context.game.set(game);
    context.players.set(players);
    context.gameInfo.set(gameInfo);
  }

  onDestroy(() => {
    currentGameId.set(null);
    currentRoom.set(null);
  });
</script>

<svelte:head>
  <title>{gameId} - Boardgamers 🌌</title>
</svelte:head>

{#if game.status === "open"}
  <OpenGame />
{:else}
  <StartedGame />
{/if}
<ChatRoom room={gameId} />
<GameSidebar />
