<script lang="ts">
  import { timerTime, defer, duration, niceDate } from "@/utils";
  import type { IGame } from "@lib/game";
  import { get } from "@/api"
  import { logoClicks } from "@/store";
  import { onDestroy } from "svelte";
  import { createWatcher, skipOnce } from "@/utils/watch";
  import { Badge, Icon, Pagination, Loading } from "@cdk";

  export let title = 'Games';
  export let perPage = 10;
  export let topRecords = false;
  export let sample = false;
  export let gameStatus: IGame['status'];
  export let boardgameId: string | undefined = undefined;
  export let userId: string | undefined = undefined;

  let loadingGames = true;
  let count = 0;
  let currentPage = 0;
  let games: IGame[] = [];

  const prefix = () => boardgameId ? `/boardgame/${boardgameId}/games/${gameStatus}` : `/game/${gameStatus}`

  const loadGames = defer(async (refresh: boolean) => {
    const queryParams = {
      count: perPage, 
      skip: currentPage * perPage,
      ... (sample && {sample: true}),
      ... (userId && {user: userId})
    };

    if (refresh) {
      loadingGames = true;

      if (!sample && !topRecords) {
        count = await get<number>(`${prefix()}/count`, queryParams);
      }
    }

    games = await get(prefix(), queryParams );
  }, () => loadingGames = false);

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
    return name === "take6" ? "6️⃣" : "🌏"
  }

  // Refresh game list each time logo is clicked
  onDestroy(logoClicks.subscribe(skipOnce(() => {
    loadGames(true)
  })))

  const onCurrentPageChanged = createWatcher(() => loadGames(false));

  $: loadGames(true), [userId, boardgameId]
  $: onCurrentPageChanged(currentPage)

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
      <ul class="list-group text-left game-list">
        {#each games as game}
          <a
            href={`/game/${game._id}`}
            class="list-group-item list-group-item-action pr-1 pl-0"
            class:active-game={game.status === "active"}
            class:current-turn={game.currentPlayers?.some((pl) => pl._id === userId)}
          >
            <span class="game-kind mx-3">
              {gameIcon(game.game.name)}
            </span>

            <div class="mr-auto" style="line-height: 1.1">
              <div>
                {#if game.status === "active"}
                  <Badge class="small">R{game.data.round}</Badge>
                {/if}
                <span class="game-name">
                  {game._id}
                </span>
                {#if playerEloChange(game)}
                  <sup class="ml-1">
                    {playerEloChange(game)}
                  </sup>
                {/if}
              </div>
              <small>
                {#if game.status !== "ended"}
                  <Icon name="clock-history" />
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
              <div class="row no-gutters factions">
                {#each game.players as player}
                  <div
                    style={`background-image: url('${
                      player.faction ? `/images/factions/icons/${player.faction}.svg` : `/api/user/${player._id}/avatar`
                    }')`}
                    title={player.faction ?? "unknown"}
                    class="player-avatar mr-1"
                    class:current={userId && player._id === userId}
                  >
                    <span class="vp">{player.score}</span>
                  </div>
                {/each}
              </div>
            {:else}
              <span class="mr-3"> {game.players.length} / {game.options.setup.nbPlayers} </span>
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

  :global(.player-avatar) {
    height: 2em;
    width: 2em;
    display: inline-block;
    position: relative;
    border-radius: 50%;
    vertical-align: middle;
    background-size: cover;

    :global(.vp) {
      position: absolute;
      right: -5px;
      bottom: -5px;
      font-size: 0.7em;
      border-radius: 5px;
      color: white;
      background-color: #838383;
      width: 20px;
      text-align: center;
    }

    :global(&.current) {
      border: 3px solid #333;

      :global(.vp) {
        background-color: #6673bc;
      }
    }
  }
</style>
