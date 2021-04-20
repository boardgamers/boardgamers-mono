<script lang="ts">
  import { duration, handleError, niceDate, oneLineMarked, pluralize, timerTime, confirm, localTimezone, skipOnce } from "@/utils";
  import marked from "marked"
  import { Badge, Button } from "@/modules/cdk";
  import { lastGameUpdate, user } from "@/store";
  import { joinGame, loadGame, unjoinGame } from "@/api/game";
  import Icon from "sveltestrap/src/Icon.svelte";
  import { navigate, route } from "@/modules/router";
  import { getContext, onDestroy } from "svelte";
  import type { GameContext } from "@/pages/Game.svelte";

  const {game, players, gameInfo}: GameContext= getContext("game")
  $: timer = $game.options.timing.timer
  $: gameId = $game._id

  const shortPlayTime = () => {
    if (timer?.start !== timer?.end) {
      return `${timerTime(timer?.start)}-${timerTime(timer?.end)}`;
    } else {
      return "24h";
    }
  };

  const playTime = () => {
    if (timer?.start !== undefined) {
      return `active between ${timerTime(timer?.start)} and ${timerTime(timer?.end)}, in your local time (${localTimezone()})`;
    } else {
      return "always active";
    }
  };

  const leave = async() => {
    if (await confirm("Are you sure you want to leave this game?")) {
      unjoinGame(gameId).then(() => navigate('/'), handleError);
    }
  };

  const join = async() => {
    if (!$user) {
      navigate({ name: "login", query: { redirect: $route!.canonicalPath } });
      return;
    }

    if ($game.options.timing.timePerGame <= 24 * 3600) {
      if (!await confirm(
        "This game has a short duration. You need to keep yourself available in order to play the game until the end."
      )) {
        return;
      }
    }

    joinGame(gameId).then((newGame) => $game = newGame).catch(handleError)
  }

  // Autorefresh when another player joins
  onDestroy(lastGameUpdate.subscribe(skipOnce(async () => {
    if ($game && $lastGameUpdate > new Date($game.updatedAt)) {
      const {game: g, players: p} = await loadGame(gameId)

      if ($game && gameId === g._id) {
        $game = g;
        $players = p;
      }
    }
  })))
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
      <span class="pl-1" title="Timezone"> <Icon name="clock-history" /> {shortPlayTime()}</span>
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

    {#if $game.options.setup.randomPlayerOrder}
      <Badge color="secondary" class="mr-1">Random player order</Badge>
    {/if}
    {#each $gameInfo.options.filter((x) => !!($game.game.options || {})[x.name]) as pref}
      <Badge color="secondary" class="mr-1">
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
    <p>Waiting on {pluralize($game.options.setup.nbPlayers - $game.players.length, "more player")}</p>
  </div>

  {#if $game.players.some((pl) => pl._id === $user?._id)}
    <Button color="warning" on:click={leave}>Leave</Button>
  {:else}
    <Button color="secondary" on:click={join}>Join!</Button>
  {/if}
</div>
