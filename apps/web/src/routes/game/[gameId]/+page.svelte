<script lang="ts">
  import { GameSidebar, OpenGame, StartedGame, ChatRoom } from "@/components";
  import type { GameFront, PlayerInfoFront, GameInfoFront } from "@bgs/models";
  import { onDestroy, setContext } from "svelte";
  import { writable } from "svelte/store";
  import EventEmitter from "eventemitter3";
  import { currentGameId, room as currentRoom } from "@/lib/stores.svelte";

  let { data } = $props();
  let game: GameFront = $derived(data.game);
  let players: PlayerInfoFront[] = $derived(data.players);
  let gameInfo: GameInfoFront = $derived(data.gameInfo);

  let gameId = $derived(game._id);
  $effect(() => {
    currentGameId.set(gameId);
    currentRoom.set(gameId);
  });

  const context = {
    game: writable<GameFront | null>(null),
    players: writable<PlayerInfoFront[]>([]),
    gameInfo: writable<GameInfoFront | null>(null),
    replayData: writable<{ start: number; end: number; current: number } | null>(null),
    emitter: new EventEmitter(),
    log: writable<string[]>([]),
  };

  setContext("game", context);

  $effect(() => {
    context.game.set(game);
    context.players.set(players);
    context.gameInfo.set(gameInfo);
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
