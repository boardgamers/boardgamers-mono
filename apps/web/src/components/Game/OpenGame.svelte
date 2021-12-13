<script lang="ts">
  import {
    duration,
    handleError,
    niceDate,
    oneLineMarked,
    pluralize,
    timerTime,
    confirm,
    localTimezone,
    skipOnce,
  } from "@/utils";
  import marked from "marked";
  import { Badge, Button } from "@/modules/cdk";
  import Icon from "sveltestrap/src/Icon.svelte";
  import { navigate, route } from "@/modules/router";
  import { getContext, onDestroy } from "svelte";
  import type { GameContext } from "@/pages/Game.svelte";
  import { playerOrderText } from "@/data/playerOrders";
  import { useAccount } from "@/composition/useAccount";
  import { useCurrentGame } from "@/composition/useCurrentGame";
  import { useRest } from "@/composition/useRest";
  import { useGame } from "@/composition/useGame";

  const { post } = useRest();

  const { account: user } = useAccount();
  const { lastGameUpdate } = useCurrentGame();
  const { loadGame, loadGamePlayers } = useGame();

  const { game, players, gameInfo }: GameContext = getContext("game");
  $: timer = $game.options.timing.timer;
  $: gameId = $game._id;

  const shortPlayTime = () => {
    if (timer?.start !== timer?.end) {
      return `${timerTime(timer?.start)}-${timerTime(timer?.end)}`;
    } else {
      return "24h";
    }
  };

  const playTime = () => {
    if (timer?.start !== undefined) {
      return `active between ${timerTime(timer?.start)} and ${timerTime(
        timer?.end
      )}, in your local time (${localTimezone()})`;
    } else {
      return "always active";
    }
  };

  const leave = async () => {
    if (await confirm("Are you sure you want to leave this game?")) {
      post(`/game/${gameId}/unjoin`).then(() => navigate("/"), handleError);
    }
  };

  const join = async () => {
    if (!$user) {
      navigate({ name: "login", query: { redirect: $route!.canonicalPath } });
      return;
    }

    if ($game.options.timing.timePerGame <= 24 * 3600) {
      if (
        !(await confirm(
          "This game has a short duration. You need to keep yourself available in order to play the game until the end."
        ))
      ) {
        return;
      }
    }

    post(`/game/${gameId}/join`).catch(handleError);
  };

  let playerOrder: number[];

  function refreshPlayerOrder() {
    playerOrder = $game.players.map((_, i) => i);
  }

  $: refreshPlayerOrder(), [$game];

  const moveUp = (playerId: number) => {
    const index = playerOrder.indexOf(playerId);

    if (index > 0) {
      [playerOrder[index - 1], playerOrder[index]] = [playerOrder[index], playerOrder[index - 1]];
    }
  };

  const moveDown = (playerId: number) => {
    const index = playerOrder.indexOf(playerId);

    if (index + 1 < playerOrder.length) {
      [playerOrder[index + 1], playerOrder[index]] = [playerOrder[index], playerOrder[index + 1]];
    }
  };

  $: canStart = $game.options.setup.nbPlayers === $game.players.length && !$game.ready && $user?._id === $game.creator;

  const start = () => {
    post(`/game/${gameId}/start`, { playerOrder: playerOrder.map((x) => $game.players[x]._id) }).catch(handleError);
  };

  // Autorefresh when another player joins
  onDestroy(
    lastGameUpdate.subscribe(
      skipOnce(async () => {
        if ($game && $lastGameUpdate > new Date($game.updatedAt)) {
          const [g, p] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);

          if ($game && gameId === g._id) {
            $game = g;
            $players = p;
          }
        }
      })
    )
  );
</script>

<div class="container pb-3">
  <h1 class="mb-3">{$gameInfo.label} – Open Game</h1>

  <div class="row">
    <div class="col-md-6">
      <h2>Description</h2>
      <div>
        {@html marked($gameInfo.description)}
      </div>
    </div>

    <div class="col-md-6">
      <h2>Rules</h2>
      <div>
        {@html marked($gameInfo.rules)}
      </div>
    </div>
  </div>

  <h2>Info</h2>
  <p>
    Game <i>{gameId}</i>, created by

    <a href={`/user/${$players.find((pl) => pl._id === $game.creator)?.name}`}>
      {$players.find((pl) => pl._id === $game.creator)?.name}
    </a>

    <br />
    <small class="text-muted">
      {#if typeof $game.options.meta?.minimumKarma === "number"}
        <span title="Minimum karma to join the game">
          ☯️ {$game.options.meta.minimumKarma}
        </span>
      {/if}

      {#if $game.options.setup.seed}
        <span title="Game seed"> 🌱 {$game.options.setup.seed}</span>
      {/if}
      <span class="ps-1" title="Timezone"> <Icon name="clock-history" /> {shortPlayTime()}</span>
    </small>
  </p>

  {#if $game.options.timing.scheduledStart}
    <div class="mb-3">
      <b>
        Game is scheduled to start on {niceDate($game.options.timing.scheduledStart)} at
        {new Date($game.options.timing.scheduledStart).toLocaleTimeString()}
      </b>
    </div>
  {/if}

  <h3>Timer</h3>

  <div>
    {duration($game.options.timing.timePerGame)} per player, with an additional
    {duration($game.options.timing.timePerMove)} per move
  </div>
  <div>Timer {playTime()}</div>

  {#if $game.game.expansions?.length > 0}
    <div class="mt-3">
      <h3>Expansions</h3>
      {#each $game.game.expansions as expansion}
        <Badge color="info">{$gameInfo.expansions?.find((xp) => xp.name === expansion)?.label}</Badge>
      {/each}
    </div>
  {/if}

  <div class="mt-3">
    <h3>Setup options</h3>

    <Badge color="secondary" class="me-1">{playerOrderText($game.options.setup.playerOrder)}</Badge>
    {#each $gameInfo.options.filter((x) => !!($game.game.options || {})[x.name]) as pref}
      <Badge color="secondary" class="me-1">
        {#if pref.type === "checkbox"}
          {@html oneLineMarked(pref.label)}
        {:else if pref.type === "select" && pref.items && pref.items.some((x) => x.name === $game.game.options[pref.name])}
          {@html oneLineMarked(
            pref.label + ": " + pref.items.find((x) => x.name === $game.game.options[pref.name])?.label
          )}
        {/if}
      </Badge>
    {/each}
  </div>

  <div class="my-3">
    <h3>Players</h3>
    {#if $game.players.length > 0}
      <div class="mb-2">
        {#each $game.players as player}
          <div>
            -
            <a href={`/user/${$players.find((pl) => pl._id === player._id)?.name}`}>
              {$players.find((pl) => pl._id === player._id)?.name}
            </a>
            - {$players.find((pl) => pl._id === player._id)?.elo} elo
          </div>
        {/each}
      </div>
    {/if}
    {#if $game.options.setup.nbPlayers > $game.players.length}
      <p>Waiting on {pluralize($game.options.setup.nbPlayers - $game.players.length, "more player")}</p>
    {:else if !$game.ready}
      {#if $user?._id === $game.creator}
        {#if $game.options.setup.playerOrder === "host"}
          <h3>Select player order</h3>
          {#each playerOrder as playerIndex}
            <div>
              - {$game.players[playerIndex].name}
              <span on:click={() => moveUp(playerIndex)}><Icon name="arrow-up" class="icon-order-player" /></span>
              <span on:click={() => moveDown(playerIndex)}><Icon name="arrow-down" class="icon-order-player" /></span>
            </div>
          {/each}
          <Button color="primary" on:click={start} class="mt-4">Start the game!</Button>
        {/if}
      {:else}
        <p><b>Waiting on host for final settings</b></p>
      {/if}
    {:else if $game.options.timing.scheduledStart}
      <p>Waiting on scheduled start</p>
    {/if}
  </div>

  {#if !canStart}
    {#if $game.players.some((pl) => pl._id === $user?._id)}
      <Button color="warning" on:click={leave}>Leave</Button>
    {:else}
      <Button color="secondary" on:click={join}>Join!</Button>
    {/if}
  {/if}
</div>

<style>
  :global(.icon-order-player) {
    cursor: pointer;
  }
</style>
