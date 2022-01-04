<script lang="ts">
  import { timerTime, defer, duration, niceDate, shortDuration } from "@/utils";
  import type { IGame } from "@bgs/types";
  import { createWatcher } from "@/utils/watch";
  import clockHistory from "@iconify/icons-bi/clock-history.js";
  import { Badge, Icon, Pagination, Loading } from "@/modules/cdk";
  import PlayerGameAvatar from "./PlayerGameAvatar.svelte";
  import { useLogoClicks } from "@/composition/useLogoClicks";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { LoadGamesResult, useGames } from "@/composition/useGames";
  import { isPromise } from "@bgs/utils";

  const { logoClicks } = useLogoClicks();
  const { gameInfo } = useGameInfo();
  const { loadGames } = useGames();

  export let title = "Games";
  export let perPage = 10;
  export let topRecords = false;
  export let sample = false;
  export let gameStatus: IGame["status"];
  export let boardgameId: string | undefined = undefined;
  export let userId: string | undefined | null = undefined;
  export let minDuration: number | undefined = undefined;
  export let maxDuration: number | undefined = undefined;

  let loadingGames = true;
  let count = 0;
  let currentPage = 0;
  let games: IGame[] = [];

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

  function playerEloChange(game: IGame) {
    const pl = game.players.find((pl) => pl._id === userId);

    if (!pl || !pl.elo) {
      return;
    }

    const elo = pl.elo.initial ?? 0;
    const delta = pl.elo.delta ?? 0;
    return elo === 0 && delta === 0 ? "" : (delta >= 0 ? "( +" : "( -") + Math.abs(delta) + " elo )";
  }

  function playTime(game: IGame) {
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

  $: load(true), [userId, boardgameId, $logoClicks];
  $: onCurrentPageChanged(), [currentPage];
</script>

<Loading loading={loadingGames}>
  <h3 class="card-title">
    {title}
    {#if !topRecords && !sample}
      <span class="small">({count})</span>
    {/if}
  </h3>
  <div>
    {#if games.length > 0}
      <ul class="list-group text-start game-list">
        {#each games as game}
          <a
            href={`/game/${game._id}`}
            class="list-group-item list-group-item-action pe-1 ps-0"
            class:active-game={game.status === "active"}
            class:current-turn={game.currentPlayers?.some((pl) => pl._id === userId)}
          >
            <span class="game-kind mx-3">
              {gameIcon(game.game.name)}
            </span>

            <div class="me-auto" style="line-height: 1.1">
              <div>
                {#if game.status === "active"}
                  <Badge color="contrast" class="small text-light">R{game.data.round}</Badge>
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
              <small>
                {#if game.status !== "ended"}
                  <Icon icon={clockHistory} inline={true} />
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
              <div class="factions g-0 row">
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
                <div class="text-end">{game.players.length} / {game.options.setup.nbPlayers}</div>
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

<style lang="postcss">
  .list-group.game-list {
    .list-group-item {
      display: flex;
      align-items: center;

      &.current-turn {
        background: lightgreen;

        &:hover,
        &:focus {
          filter: brightness(95%);
        }

        &:active {
          filter: brightness(90%);
        }
      }

      &.active-game {
        .factions {
          /* On mobile, if multiple lines, I want items to be aligned to the right */
          justify-content: flex-end;
        }
      }

      .game-kind {
        font-size: 1.8em;
      }

      .game-name {
        /* font-weight: 600; */
      }
    }
  }
</style>
