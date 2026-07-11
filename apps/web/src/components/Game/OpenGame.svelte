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
  import type { GameContext } from "@/routes/game/[gameId]/game-context";
  import { playerOrderText } from "@/data/playerOrders";
  import { account as user } from "@/lib/account.svelte";
  import { lastGameUpdate } from "@/lib/stores.svelte";
  import { get, post } from "@/lib/api";
  import { loadGame, loadGamePlayers } from "@/lib/game.svelte";
  import { goto } from "$app/navigation";
  import { redirectLoggedIn } from "@/utils/redirect";
  import { page } from "$app/stores";
  import SEO from "../SEO.svelte";
  import removeMarkdown from "remove-markdown";
  import { gameLabel } from "@/utils/game-label";
  import type { UserFront } from "@bgs/models";
  import { debounce, map } from "lodash";

  const context = getContext("game") as GameContext;
  let timer = $derived(context.game?.options.timing.timer);
  let gameId = $derived(context.game?._id);

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

    if (context.game && context.game.options.timing.timePerGame <= 24 * 3600) {
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

  let playerOrder = $state<number[]>([]);

  function refreshPlayerOrder() {
    if (context.game) {
      playerOrder = context.game.players.map((_, i) => i);
    }
  }

  $effect(() => {
    context.game;
    refreshPlayerOrder();
  });

  const moveUp = (playerId: number) => {
    const index = playerOrder.indexOf(playerId);

    if (index > 0) {
      const tmp = playerOrder[index - 1];
      playerOrder[index - 1] = playerOrder[index];
      playerOrder[index] = tmp;
      playerOrder = playerOrder;
    }
  };

  const moveDown = (playerId: number) => {
    const index = playerOrder.indexOf(playerId);

    if (index + 1 < playerOrder.length) {
      const tmp = playerOrder[index + 1];
      playerOrder[index + 1] = playerOrder[index];
      playerOrder[index] = tmp;
      playerOrder = playerOrder;
    }
  };

  let canStart = $derived(
    context.game
      ? context.game.options.setup.nbPlayers === context.game.players.length &&
          !context.game.ready &&
          $user?._id === context.game.creator
      : false
  );

  const start = () => {
    post(`/game/${gameId}/start`, { playerOrder: playerOrder.map((x) => context.game?.players[x]._id) }).catch(
      handleError
    );
  };

  let isOpen = $state(false);

  let foundUsers = $state<UserFront[]>([]);
  let query = $state("");

  const invite = defer(async (userId: string, isName = false) => {
    if (isName) {
      const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(userId)}`);
      userId = user._id;
    }
    post(`/game/${gameId}/invite`, { userId });
  });

  const watcher = debounce(
    async () => {
      if (query) {
        foundUsers = (await get<UserFront[]>("/user/search", { name: query.trim() }).catch(handleError)) || [];
      } else {
        foundUsers = [];
      }
    },
    400,
    { leading: false }
  );

  $effect(() => {
    query;
    watcher();
  });

  const updateGameWatcher = createWatcher(async () => {
    if (context.game && $lastGameUpdate > new Date(context.game.updatedAt)) {
      const [g, p] = await Promise.all([loadGame(gameId), loadGamePlayers(gameId)]);

      if (context.game && gameId === g._id) {
        context.game = g;
        context.players = p;
      }
    }
  });

  // Autorefresh when another player joins
  $effect(() => {
    $lastGameUpdate;
    updateGameWatcher();
  });
</script>

<SEO
  title="{gameId} - {gameLabel(context.gameInfo?.label)} game"
  description="{context.game?.players.length} / {context.game?.options.setup.nbPlayers} players. Timer of {duration(
    context.game?.options.timing.timePerGame
  )} per player, with an additional {duration(context.game?.options.timing.timePerMove)} per move.
{context.game?.game.expansions?.length > 0 &&
    `
      Expansions: ${context.game?.game.expansions.join(',')}\\n`}
{context.gameInfo?.options
    .filter((x) => !!(context.game?.game.options || {})[x.name])
    .map((pref) =>
      pref.type === 'checkbox'
        ? pref.label
        : pref.type === 'select' && pref.items
          ? pref.label + ': ' + pref.items.find((x) => x.name === context.game?.game.options[pref.name])?.label
          : ''
    )
    .filter(Boolean)
    .map((str) => `- ${removeMarkdown(str)}`)
    .join('\\n')}"
/>

<div class="container mx-auto px-4 pb-3">
  <h1 class="mb-3">{context.gameInfo?.label} – Open Game</h1>

  <div class="grid grid-cols-1 md:grid-cols-2">
    <div>
      <h2>Description</h2>
      <div>
        {@html marked(context.gameInfo?.description)}
      </div>
    </div>

    <div>
      <h2>Rules</h2>
      <div>
        {@html marked(context.gameInfo?.rules)}
      </div>
    </div>
  </div>

  <h2>Info</h2>
  <p>
    Game <i>{gameId}</i>, created by

    <a href={`/user/${context.players.find((pl) => pl._id === context.game?.creator)?.name}`}>
      {context.players.find((pl) => pl._id === context.game?.creator)?.name}
    </a>

    <br />
    <small class="text-gray-500 dark:text-gray-400">
      {#if typeof context.game?.options.meta?.minimumKarma === "number"}
        <span title="Minimum karma to join the game">
          ☯️ {context.game.options.meta.minimumKarma}
        </span>
      {/if}

      {#if context.game?.options.setup.seed}
        <span title="Game seed"> 🌱 {context.game.options.setup.seed}</span>
      {/if}
      <span class="ps-1" title="Timezone"> <Icon icon={clockHistory} inline={true} /> {shortPlayTime()}</span>
    </small>
  </p>

  {#if context.game?.options.timing.scheduledStart}
    <div class="mb-3">
      <b>
        Game is scheduled to start on {niceDate(context.game.options.timing.scheduledStart)} at
        {new Date(context.game.options.timing.scheduledStart).toLocaleTimeString("en")}
      </b>
    </div>
  {/if}

  <h3>Timer</h3>

  <div>
    {duration(context.game?.options.timing.timePerGame)} per player, with an additional
    {duration(context.game?.options.timing.timePerMove)} per move
  </div>
  <div>Timer {playTime()}</div>

  {#if context.game?.game.expansions?.length > 0}
    <div class="mt-3">
      <h3>Expansions</h3>
      {#each context.game.game.expansions as expansion}
        <Badge color="info"
          >{@html oneLineMarked(context.gameInfo?.expansions.find((xp) => xp.name === expansion)?.label ?? "")}</Badge
        >
      {/each}
    </div>
  {/if}

  <div class="mt-3">
    <h3>Setup options</h3>

    <Badge color="secondary" class="me-1">{playerOrderText(context.game?.options.setup.playerOrder)}</Badge>
    {#each context.gameInfo?.options.filter((x) => !!(context.game?.game.options || {})[x.name]) as pref}
      <Badge color="secondary" class="me-1">
        {#if pref.type === "checkbox"}
          {@html oneLineMarked(pref.label)}
        {:else if pref.type === "select" && pref.items && pref.items.some((x) => x.name === context.game?.game.options[pref.name])}
          {@html oneLineMarked(
            pref.label + ": " + pref.items.find((x) => x.name === context.game?.game.options[pref.name])?.label
          )}
        {/if}
      </Badge>
    {/each}
  </div>

  <div class="my-3">
    <h3>Players</h3>
    {#if context.game && context.game.players.length > 0}
      <div class="mb-2">
        {#each context.game.players as player}
          <div>
            -
            <a href={`/user/${context.players.find((pl) => pl._id === player._id)?.name}`}>
              {context.players.find((pl) => pl._id === player._id)?.name}
            </a>
            - {context.players.find((pl) => pl._id === player._id)?.elo} elo {#if player.pending}<span
                class="text-gray-500 dark:text-gray-400"
              >
                (invited)
              </span>{/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if context.game && context.game.options.setup.nbPlayers > context.game.players.length}
      <p>Waiting on {pluralize(context.game.options.setup.nbPlayers - context.game.players.length, "more player")}</p>
      {#if $user?._id === context.game.creator && (1 || context.game.options.timing.scheduledStart)}
        <FormGroup>
          <label for="invite">Invite player</label>
          <Dropdown isOpen={Boolean(isOpen && foundUsers.length)} toggle={() => (isOpen = !isOpen)}>
            <DropdownToggle tag="div" class="inline-block">
              <Input
                id="invite"
                bind:value={query}
                onkeydown={(e) => e.key === "Enter" && invite(e.target.value, true)}
              />
            </DropdownToggle>
            <DropdownMenu>
              {#each foundUsers as result}
                <DropdownItem onclick={() => invite(result._id)}>{result.account.username}</DropdownItem>
              {/each}
            </DropdownMenu>
          </Dropdown>
        </FormGroup>
      {/if}
    {:else if context.game && !context.game.ready}
      {#if $user?._id === context.game.creator}
        {#if context.game.options.setup.playerOrder === "host"}
          <h3>Select player order</h3>
          {#each playerOrder as playerIndex}
            <div>
              - {context.game.players[playerIndex].name}
              <span
                onclick={() => moveUp(playerIndex)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === "Enter" && moveUp(playerIndex)}><Icon icon={arrowUp} inline={true} /></span
              >
              <span
                onclick={() => moveDown(playerIndex)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === "Enter" && moveDown(playerIndex)}
                ><Icon icon={arrowDown} inline={true} /></span
              >
            </div>
          {/each}
          <Button color="primary" onclick={start} class="mt-4">Start the game!</Button>
        {/if}
      {:else if context.game.players.some((p) => p.pending)}
        <p>Waiting on some players to accept the invitation.</p>
      {:else}
        <p><b>Waiting on host for final settings</b></p>
      {/if}
    {:else if context.game?.options.timing.scheduledStart}
      <p>Waiting on scheduled start</p>
    {/if}
  </div>

  {#if !canStart && context.game}
    {#if context.game.players.some((pl) => pl._id === $user?._id)}
      {#if context.game.players.find((pl) => pl._id === $user._id).pending}
        <Button color="accent" onclick={join}>Accept invitation</Button>
        <Button color="secondary" onclick={leave}>Refuse invitation</Button>
      {:else}
        <Button color="warning" onclick={leave}>Leave</Button>
      {/if}
    {:else}
      <Button color="accent" onclick={join}>Join!</Button>
    {/if}
  {/if}
</div>
