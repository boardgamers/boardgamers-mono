<script lang="ts">
  import "../../app.css";

  import { Appbar, Sidebar } from "@/components";
  import { activeGames } from "@/lib/stores.svelte";
  import { initNProgress } from "@/lib/nprogress.svelte";
  import { page } from "$app/stores";
  import { setContext, onDestroy } from "svelte";
  import EventEmitter from "eventemitter3";
  import type { GameFront, GameInfoFront, PlayerInfoFront } from "@bgs/models";
  import type { GameContext } from "./[gameId]/game-context";
  import { currentGameId, room as currentRoom } from "@/lib/stores.svelte";

  initNProgress();

  let { children } = $props();

  // Game context is set at the layout level so both the page content (inside <main>)
  // and the Sidebar (sibling) can access it via getContext("game").
  let game = $derived($page.data.game as GameFront | undefined);
  let players = $derived($page.data.players as PlayerInfoFront[] | undefined);
  let gameInfo = $derived($page.data.gameInfo as GameInfoFront | undefined);

  let gameId = $derived(game?._id);
  $effect(() => {
    if (gameId) {
      currentGameId.set(gameId);
      currentRoom.set(gameId);
    }
  });

  const context: GameContext = $state({
    game: ($page.data.game as GameFront) ?? null,
    players: ($page.data.players as PlayerInfoFront[]) ?? [],
    gameInfo: ($page.data.gameInfo as GameInfoFront) ?? null,
    replayData: null as { start: number; end: number; current: number } | null,
    emitter: new EventEmitter(),
    log: [] as string[],
  });

  setContext<GameContext>("game", context);

  // Keep context in sync when page data changes
  $effect(() => {
    context.game = game ?? null;
    context.players = players ?? [];
    context.gameInfo = gameInfo ?? null;
  });

  onDestroy(() => {
    currentGameId.set(null);
    currentRoom.set(null);
  });
</script>

<svelte:head>
  <link
    rel="shortcut icon"
    type="image/png"
    id="favicon-site"
    href={$activeGames.length > 0 ? "/favicon-active.ico" : "/favicon.ico"}
  />
</svelte:head>

<div class="flex min-h-screen flex-col">
  <div class="flex flex-1 flex-row">
    <div class="flex flex-1 flex-col">
      <Appbar class="mb-3" />
      <main class="flex-1">
        {@render children()}
      </main>
    </div>
    <Sidebar />
  </div>
</div>
