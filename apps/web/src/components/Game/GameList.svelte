<script lang="ts">
  import { timerTime, defer, duration, niceDate, shortDuration } from "@/utils";
  import type { GameFront } from "@bgs/models";
  import { createWatcher } from "@/utils/watch";
  import { Badge, Pagination, Loading } from "@/modules/cdk";
  import IconClockHistory from "@/components/icons/IconClockHistory.svelte";
  import PlayerGameAvatar from "./PlayerGameAvatar.svelte";
  import { logoClicks } from "@/lib/stores.svelte";
  import { gameInfo } from "@/lib/game-info.svelte";
  import { loadGames, type LoadGamesResult } from "@/lib/games.svelte";
  import { isPromise } from "@bgs/utils";

  let {
    title = "Games",
    perPage = 10,
    topRecords = false,
    sample = false,
    gameStatus,
    boardgameId = undefined,
    userId = undefined,
    minDuration = undefined,
    maxDuration = undefined,
  }: {
    title?: string;
    perPage?: number;
    topRecords?: boolean;
    sample?: boolean;
    gameStatus: GameFront["status"];
    boardgameId?: string | undefined;
    userId?: string | undefined | null;
    minDuration?: number | undefined;
    maxDuration?: number | undefined;
  } = $props();

  let loadingGames = $state(true);
  let count = $state(0);
  let currentPage = $state(0);
  let games = $state<GameFront[]>([]);

  const load = defer(
    (refresh: boolean) => {
      const fetchCount = refresh && !topRecords && !sample;

      const result = loadGames({
        gameStatus,
        boardgameId,
        userId,
        sample,
        minDuration,
        maxDuration,
        count: perPage,
        skip: currentPage * perPage,
        fetchCount,
      });

      const handleResult = (result: LoadGamesResult) => {
        games = result.games;

        if (fetchCount) {
          count = result.total;
        }
      };

      // We don't want to be a promise if not needed, for SSR
      if (!isPromise(result)) {
        return handleResult(result);
      } else {
        return result.then(handleResult);
      }
    },
    () => (loadingGames = false)
  );

  // Initial load: run synchronously during component init so SSR has data.
  load(true);

  function playerEloChange(game: GameFront) {
    const pl = game.players.find((pl) => pl._id === userId);

    if (!pl || !pl.elo) {
      return;
    }

    const elo = pl.elo.initial ?? 0;
    const delta = pl.elo.delta ?? 0;
    return elo === 0 && delta === 0 ? "" : (delta >= 0 ? "( +" : "( -") + Math.abs(delta) + " elo )";
  }

  function playTime(game: GameFront) {
    if (game.options.timing.timer?.start !== game.options.timing.timer?.end) {
      return `${timerTime(game.options.timing.timer?.start)}-${timerTime(game.options.timing.timer?.end)}`;
    } else {
      return "24h";
    }
  }

  function gameIcon(name: string) {
    const game = gameInfo(name, "latest");

    return game?.label.trim().slice(0, game?.label.trim().indexOf(" "));
  }

  const onCurrentPageChanged = createWatcher(() => load(false));

  let firstRun = true;

  $effect(() => {
    userId;
    boardgameId;
    $logoClicks;
    // Skip the first run — initial load already happened synchronously above.
    if (firstRun) {
      firstRun = false;
      return;
    }
    load(true);
  });


  $effect(() => {
    currentPage;
    onCurrentPageChanged();
  });
</script>

<Loading loading={loadingGames}>
  <h3 class="font-semibold">
    {title}
    {#if !topRecords && !sample}
      <span class="text-xs">({count})</span>
    {/if}
  </h3>
  <div>
    {#if games.length > 0}
      <ul class="divide-y divide-accent/80 rounded-lg border border-accent/80 bg-white text-start dark:divide-accent/60 dark:border-accent/60 dark:bg-gray-900 game-list">
        {#each games as game}
          <a
            href={`/game/${game._id}`}
            class="no-link flex cursor-pointer items-center px-4 py-2 pe-1 ps-0 hover:bg-gray-50 dark:hover:bg-gray-800 game-item"
            class:active-game={game.status === "active"}
            class:current-turn={game.currentPlayers?.some((pl) => pl._id === userId)}
          >
            <span class="game-kind mx-3">
              {gameIcon(game.game.name)}
            </span>

            <div class="me-auto" style="line-height: 1.1">
              <div>
                {#if game.status === "active"}
                  <Badge color="contrast" class="text-xs text-white">R{game.context?.round ?? 0}</Badge>
                {/if}
                <span class="game-name">
                  {game._id}
                </span>
                {#if playerEloChange(game)}
                  <sup class="ms-1">
                    {playerEloChange(game)}
                  </sup>
                {/if}
              </div>
              <small class="flex items-center gap-1 whitespace-nowrap text-xs">
                {#if game.status !== "ended"}
                  <IconClockHistory class="text-[0.8em]" />
                  {playTime(game)}
                  {duration(game.options.timing.timePerGame)} + {duration(game.options.timing.timePerMove)}
                  {#if game.options.timing.scheduledStart}
                    starts on {niceDate(game.options.timing.scheduledStart)} at
                    {new Date(game.options.timing.scheduledStart).getHours().toString().padStart(2, "0")}}h{new Date(
                      game.options.timing.scheduledStart
                    )
                      .getMinutes()
                      .toString()
                      .padStart(2, "0")}
                  {/if}
                {:else}
                  {niceDate(game.lastMove)}
                {/if}
              </small>
            </div>

            {#if game.status !== "open"}
              <div class="factions flex flex-row">
                {#each game.players as player}
                  <PlayerGameAvatar
                    game={game.game.name}
                    isCurrent={game.currentPlayers?.some((pl) => pl._id === player._id)}
                    {userId}
                    {player}
                    class="me-1"
                  />
                {/each}
              </div>
            {:else}
              <div class="me-3" style="line-height: 1.1;">
                <div class="text-right">{game.players.length} / {game.options.setup.nbPlayers}</div>
                <small>
                  {shortDuration(Math.floor((Date.now() - new Date(game.createdAt).getTime()) / 1000))} ago</small
                >
              </div>
            {/if}
          </a>
        {/each}
      </ul>
      {#if !topRecords && count > perPage}
        <Pagination {count} {perPage} bind:currentPage align="right" class="mt-2" />
      {/if}
    {:else}
      <p>No games to show</p>
    {/if}
  </div>
</Loading>

<style>
  .game-list .game-item {
    display: flex;
    align-items: center;
  }

  .game-list .game-item.current-turn {
    background: lightgreen;
  }

  .game-list .game-item.current-turn:hover,
  .game-list .game-item.current-turn:focus {
    filter: brightness(95%);
  }

  .game-list .game-item.current-turn:active {
    filter: brightness(90%);
  }

  /* On mobile, if multiple lines, I want items to be aligned to the right */
  .game-list .game-item.active-game .factions {
    justify-content: flex-end;
  }

  .game-list .game-item .game-kind {
    font-size: 1.8em;
  }
</style>
