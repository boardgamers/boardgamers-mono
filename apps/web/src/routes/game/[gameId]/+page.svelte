<script lang="ts">
  import { GameSidebar, OpenGame, StartedGame, ChatRoom } from "@/components";
  import type { GameFront, PlayerInfoFront, GameInfoFront } from "@bgs/models";
  import { onDestroy, setContext } from "svelte";
  import EventEmitter from "eventemitter3";
  import { currentGameId, room as currentRoom } from "@/lib/stores.svelte";
  import type { GameContext } from "./game-context";

  let { data } = $props();
  let game: GameFront = $derived(data.game);
  let players: PlayerInfoFront[] = $derived(data.players);
  let gameInfo: GameInfoFront = $derived(data.gameInfo);

  let gameId = $derived(game._id);
  $effect(() => {
    currentGameId.set(gameId);
    currentRoom.set(gameId);
  });

  // $state works across components via context — children read/write the same reactive object.
  const context: GameContext = $state({
    game: null as GameFront | null,
    players: [] as PlayerInfoFront[],
    gameInfo: null as GameInfoFront | null,
    replayData: null as { start: number; end: number; current: number } | null,
    emitter: new EventEmitter(),
    log: [] as string[],
  });

  setContext<GameContext>("game", context);

  $effect(() => {
    context.game = game;
    context.players = players;
    context.gameInfo = gameInfo;
  });

  onDestroy(() => {
    currentGameId.set(null);
    currentRoom.set(null);
  });
</script>

{#if game.status === "open"}
  <OpenGame />
{:else}
  <StartedGame />
{/if}
<ChatRoom room={gameId} />
<GameSidebar />