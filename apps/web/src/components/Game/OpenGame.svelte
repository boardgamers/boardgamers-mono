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
    createWatcher,
    defer,
  } from "@/utils";
  import clockHistory from "@iconify/icons-bi/clock-history.js";
  import arrowDown from "@iconify/icons-bi/arrow-down.js";
  import arrowUp from "@iconify/icons-bi/arrow-up.js";
  import marked from "marked";
  import {
    Badge,
    Button,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownToggle,
    FormGroup,
    Input,
    Icon,
  } from "@/modules/cdk";
  import { getContext } from "svelte";
  import type { GameContext } from "@/routes/game/[gameId].svelte";
  import { playerOrderText } from "@/data/playerOrders";
  import { useAccount } from "@/composition/useAccount";
  import { useCurrentGame } from "@/composition/useCurrentGame";
  import { useRest } from "@/composition/useRest";
  import { useGame } from "@/composition/useGame";
  import { goto } from "$app/navigation";
  import { redirectLoggedIn } from "@/utils/redirect";
  import { page } from "$app/stores";
  import SEO from "../SEO.svelte";
  import removeMarkdown from "remove-markdown";
  import { gameLabel } from "@/utils/game-label";
  import type { IUser } from "@bgs/types";
  import { debounce, map } from "lodash";

  const { post, get } = useRest();

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
      post(`/game/${gameId}/unjoin`).then(() => goto("/"), handleError);
    }
  };

  const join = async () => {
    if (!$user) {
      goto(redirectLoggedIn($page.url));
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

  let isOpen = false;

  let foundUsers: IUser[] = [];
  let query = "";

  const invite = defer(async (userId: string, isName = false) => {
    if (isName) {
      const user = await get<IUser>(`/user/infoByName/${encodeURIComponent(userId)}`);
      userId = user._id;
    }
    post(`/game/${gameId}/invite`, { userId });
  });

  const watcher = debounce(
    async () => {
      if (query) {
        foundUsers = (await get<IUser[]>("/user/search", { name: query.trim() }).catch(handleError)) || [];
      } else {
        foundUsers = [];
      }
    },
    400,
    { leading: false }
  );

  $: watcher(), query;

  const updateGameWatcher = createWatcher(async () => {
    if ($game && $lastGameUpdate > new Date($game.updatedAt)) {
      const [g, p] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);

      if ($game && gameId === g._id) {
        $game = g;
        $players = p;
      }
    }
  });

  // Autorefresh when another player joins
  $: updateGameWatcher(), $lastGameUpdate;
</script>

<SEO
  title="{gameId} - {gameLabel($gameInfo.label)} game"
  description="{$game.players.length} / {$game.options.setup.nbPlayers} players. Timer of {duration(
    $game.options.timing.timePerGame
  )} per player, with an additional {duration($game.options.timing.timePerMove)} per move. 
{$game.game.expansions?.length > 0 &&
    `
      Expansions: ${$game.game.expansions.join(',')}
`}
{$gameInfo.options
    .filter((x) => !!($game.game.options || {})[x.name])
    .map((pref) =>
      pref.type === 'checkbox'
        ? pref.label
        : pref.type === 'select' && pref.items
        ? pref.label + ': ' + pref.items.find((x) => x.name === $game.game.options[pref.name])?.label
        : ''
    )
    .filter(Boolean)
    .map((str) => `- ${removeMarkdown(str)}`)
    .join('\n')}"
/>

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
      <span class="ps-1" title="Timezone"> <Icon icon={clockHistory} inline={true} /> {shortPlayTime()}</span>
    </small>
  </p>

  {#if $game.options.timing.scheduledStart}
    <div class="mb-3">
      <b>
        Game is scheduled to start on {niceDate($game.options.timing.scheduledStart)} at
        {new Date($game.options.timing.scheduledStart).toLocaleTimeString("en")}
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
            - {$players.find((pl) => pl._id === player._id)?.elo} elo {#if player.pending}<span class="text-muted">
                (invited)
              </span>{/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if $game.options.setup.nbPlayers > $game.players.length}
      <p>Waiting on {pluralize($game.options.setup.nbPlayers - $game.players.length, "more player")}</p>
      {#if $user?._id === $game.creator && (1 || $game.options.timing.scheduledStart)}
        <FormGroup>
          <label for="invite">Invite player</label>
          <Dropdown isOpen={Boolean(isOpen && foundUsers.length)} toggle={() => (isOpen = !isOpen)}>
            <DropdownToggle tag="div" class="d-inline-block">
              <Input
                id="invite"
                bind:value={query}
                on:keydown={(e) => e.key === "Enter" && invite(e.target.value, true)}
              />
            </DropdownToggle>
            <DropdownMenu>
              {#each foundUsers as result}
                <DropdownItem on:click={() => invite(result._id)}>{result.account.username}</DropdownItem>
              {/each}
            </DropdownMenu>
          </Dropdown>
        </FormGroup>
      {/if}
    {:else if !$game.ready}
      {#if $user?._id === $game.creator}
        {#if $game.options.setup.playerOrder === "host"}
          <h3>Select player order</h3>
          {#each playerOrder as playerIndex}
            <div>
              - {$game.players[playerIndex].name}
              <span on:click={() => moveUp(playerIndex)} role="button"><Icon icon={arrowUp} inline={true} /></span>
              <span on:click={() => moveDown(playerIndex)} role="button"><Icon icon={arrowDown} inline={true} /></span>
            </div>
          {/each}
          <Button color="primary" on:click={start} class="mt-4">Start the game!</Button>
        {/if}
      {:else if $game.players.some((p) => p.pending)}
        <p>Waiting on some players to accept the invitation.</p>
      {:else}
        <p><b>Waiting on host for final settings</b></p>
      {/if}
    {:else if $game.options.timing.scheduledStart}
      <p>Waiting on scheduled start</p>
    {/if}
  </div>

  {#if !canStart}
    {#if $game.players.some((pl) => pl._id === $user?._id)}
      {#if $game.players.find((pl) => pl._id === $user._id).pending}
        <Button color="accent" on:click={join}>Accept invitation</Button>
        <Button color="secondary" on:click={leave}>Refuse invitation</Button>
      {:else}
        <Button color="warning" on:click={leave}>Leave</Button>
      {/if}
    {:else}
      <Button color="accent" on:click={join}>Join!</Button>
    {/if}
  {/if}
</div>
