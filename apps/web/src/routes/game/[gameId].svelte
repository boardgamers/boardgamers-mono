<script context="module" lang="ts">
  import type { Writable } from "svelte/store";
  import type { LoadInput } from "@sveltejs/kit";

  export type GameContext = {
    game: Writable<IGame>;
    players: Writable<PlayerInfoFront[]>;
    gameInfo: Writable<GameInfo>;
    replayData: Writable<{ start: number; end: number; current: number } | null>;
    emitter: EventEmitter;
    log: Writable<string[]>;
  };

  export async function load(input: LoadInput) {
    const { gameInfo, loadGame, loadGamePlayers, loadGameInfo, loadGamePreferences } = useLoad(
      input,
      useGameInfo,
      useGame,
      useGamePreferences
    );

    const gameId = input.params.gameId;

    let game, players;
    try {
      [game, players] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);
    } catch {
      // loadGame rejects with Error("Not Found") (status 404) when the gameplay API returns 404.
      return {
        status: 404,
        error: new Error("Game not found"),
      };
    }

    // game.game can be absent on legacy/corrupt docs — Mongo validation is "warn"/"moderate",
    // so the schema is not enforced on existing data. Guard before dereferencing.
    if (!game?.game) {
      return {
        status: 404,
        error: new Error("Game data is incomplete"),
      };
    }

    await Promise.all([loadGameInfo(game.game.name, game.game.version), loadGamePreferences(game.game.name)]);

    return {
      props: {
        game,
        players,
        gameInfo: gameInfo(game.game.name, game.game.version),
      },
    };
  }
</script>

<script lang="ts">
  import { GameSidebar, OpenGame, StartedGame, ChatRoom } from "@/components";
  import type { IGame, PlayerInfoFront, GameInfo } from "@bgs/models";
  import { onDestroy, setContext } from "svelte";
  import { writable } from "svelte/store";
  import EventEmitter from "eventemitter3";
  import { useLoad } from "@/composition/useLoad";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { useGame } from "@/composition/useGame";
  import { useCurrentGame } from "@/composition/useCurrentGame";
  import { useCurrentRoom } from "@/composition/useCurrentRoom";
  import { useGamePreferences } from "@/composition/useGamePreferences";

  const { currentGameId } = useCurrentGame();
  const { room: currentRoom } = useCurrentRoom();

  export let game: IGame;
  export let players: PlayerInfoFront[];
  export let gameInfo: GameInfo;

  $: gameId = game._id;
  $: currentGameId.set(gameId);
  $: currentRoom.set(gameId);

  const context = {
    game: writable<IGame | null>(null),
    players: writable<PlayerInfoFront[]>([]),
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

{#if game.status === "open"}
  <OpenGame />
{:else}
  <StartedGame />
{/if}
<ChatRoom room={gameId} />
<GameSidebar />
