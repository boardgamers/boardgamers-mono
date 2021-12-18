<script context="module" lang="ts">
  import type { Writable } from "svelte/store";
  import type { LoadInput } from "@sveltejs/kit";

  export type GameContext = {
    game: Writable<IGame>;
    players: Writable<PlayerInfo[]>;
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

    const gameId = input.page.params.gameId;

    const [game, players] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);
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
  import type { IGame, PlayerInfo, GameInfo } from "@bgs/types";
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

{#if game.status === "open"}
  <OpenGame />
{:else}
  <StartedGame />
{/if}
<ChatRoom room={gameId} />
<GameSidebar />
