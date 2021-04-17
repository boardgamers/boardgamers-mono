<script lang="ts">
import { keyBy, debounce } from "lodash";
import { timerTime, oneLineMarked, handleError, confirm, duration, shortDuration } from "../utils";
import DOMPurify from "dompurify";
import type { IGame, PlayerInfo } from "@lib/game";
import Portal from "svelte-portal";
import { playerStatus, user } from "@/store";
import { Button, FormGroup, Icon, Input, Badge, Checkbox, Label } from "@/modules/cdk";
import { boardgameInfo, get, post } from "@/api";
import { createEventDispatcher, onDestroy } from "svelte";
import PreferencesChooser from "./Settings/PreferencesChooser.svelte";

export let game: IGame;
export let players: PlayerInfo[]
export let log: string[] = []
export let replayData: { stard: number; end: number; current: number } | null = null;

const gameInfo = boardgameInfo(game.game.name, game.game.version)!

let secondsCounter = 0;

const interval = setInterval(() => {
  if (!document.hidden) {
    secondsCounter += 1;
  }
}, 1000);
onDestroy(() => clearInterval(interval))

let showLog = !!localStorage.getItem("show-log");
let showNotes = localStorage.getItem("show-notes") !== "false";

let notes = ''
let lastReceivedNotes: string | null = null
let notesLoaded = false
let userId: string  | undefined

async function loadNotes() {
  if (userId) {
    lastReceivedNotes = notes = await get(`/game/${game._id}/notes`);
    notesLoaded = true
  }
}

$: userId = $user?._id
$: loadNotes(), [userId]

let  settings: Record<string, unknown> | null = null;
let  requestedDrop: Record<string, boolean> = {};

$: showPreferences = !!gameInfo?.viewer?.alternate?.url || gameInfo.preferences?.length > 0

$: playerUser = game.players.find((pl) => pl._id === userId)

function status(playerId: string) {
  return $playerStatus?.find(pl => pl._id === playerId)?.status ?? 'offline'
}

function playerElo(playerId: string) {
  return players.find((pl) => pl._id === playerId)?.elo ?? 0;
}

const alwaysActive = game.options.timing.timer?.start === game.options.timing.timer?.end

function logToHtml(log: string) {
  return DOMPurify.sanitize(oneLineMarked(log));
}

$: currentPlayersById = keyBy(game?.currentPlayers ?? [], "_id");


function isCurrentPlayer(id: string) {
  return game.status !== "ended" && !!currentPlayersById[id];
}

let remainingTimes: Record<string, number> = {}

function updateRemainingTimes() {
  const ret: Record<string, number> = {}
  for (const player of game.players) {
    ret[player._id] = remainingTime(player)
  }

  remainingTimes = ret
}

$: updateRemainingTimes(), [secondsCounter]

function remainingTime(player: PlayerInfo) {
  const currentPlayer = currentPlayersById[player._id];
  if (currentPlayer) {
    // Trick to update every second
    return Math.floor((new Date(currentPlayer.deadline).getTime() - Date.now() + (secondsCounter % 1)) / 1000);
  }
  return Math.max(player.remainingTime, 0);
}

let updateNotesDebounce = debounce(async () => {
  if ($user && notes !== lastReceivedNotes) {
    await post(`/game/${game._id}/notes`, { notes });
  }
}, 800, { leading: false, trailing: true });

async function postSettings() {
  if (!$user) {
    return;
  }
  await post(`/gameplay/${game._id}/settings`, settings as any);
}

async function voteCancel() {
  if (await confirm("This vote cannot be taken back. If all active players vote to cancel, the game will be cancelled.")) {
    await post(`/game/${game._id}/cancel`).catch(handleError);
  }
}

async function quit() {
  await post(`/game/${game._id}/quit`).catch(handleError);
}

async function requestDrop(playerId: string) {
  await post(`/game/${game._id}/drop/${playerId}`)
    .then(() => (requestedDrop = {...requestedDrop, [playerId]: true}), handleError);
}

const dispatch = createEventDispatcher()

function startReplay() {
  dispatch("replay:start");
}

function replayTo(dest: number) {
  dispatch("replay:to", dest);
}

function endReplay() {
  dispatch("replay:end");
}

$: gameStatus = game.status

async function loadSettings() {
  if (gameStatus !== "active" || !playerUser) {
    settings = null;
    return;
  }
  if (gameInfo.settings?.length > 0) {
    settings = await get(`/gameplay/${game._id}/settings`).catch(handleError);
  } else {
    settings = null;
  }
}

$: loadSettings(), [gameStatus, userId]

function toggleShowLog() {
  showLog = !showLog
  localStorage.setItem("show-log", showLog ? "true" : "");
}

function toggleNotes() {
  showNotes = !showNotes
  localStorage.setItem("show-notes", showNotes ? "true" : "");
}
</script>

<Portal target="#sidebar">
  <h3 class="mt-75">Players</h3>
  {#each game.players as player}
    <div class="mb-1 d-flex align-items-center player-row" class:active={isCurrentPlayer(player._id)}>
      <div
        style={`background-image: url('${
          player.faction ? `/images/factions/icons/${player.faction}.svg` : `/api/user/${player._id}/avatar`
        }')`}
        title={player.faction || "unknown"}
        class="player-avatar mr-2"
        class:current={player._id === userId}
      >
        <span class={"vp " + status(player._id)}>{player.score}</span>
      </div>

      <div>
        <a href={`/user/${player.name}`} class="player-name" class:dropped={player.dropped}>
          {player.name}
        </a>
        <sup class="ml-1">
          {#if player.elo}
            {player.elo.initial} {player.elo.delta >= 0 ? "+" : "-"} {Math.abs(player.elo.delta)} elo
          {:else}
            {playerElo(player._id)} elo
          {/if}
        </sup>
        {#if game.status === "active"}
          <span class="ml-1"> - {shortDuration(remainingTimes[player._id])}</span>
        {/if}
      </div>
    </div>
  {/each}
  <div class="mt-75">
    <Icon name="clock-history" class="mr-1" />
    {alwaysActive ? "24h" : `${timerTime(game.options.timing.timer.start)}-${timerTime(game.options.timing.timer.end)}`}
    / {duration(game.options.timing.timePerGame)} + {duration(game.options.timing.timePerMove)}
  </div>
  {#if game.status === "ended"}
    <div class="mt-75">
      <b> Game ended! </b>
    </div>
  {/if}
  {#if $user && isCurrentPlayer($user._id)}
    <div class="mt-75">
      <b class="your-turn">Your turn!</b>
    </div>
  {/if}
  {#if playerUser && game.status !== "ended"}
    <div class="mt-75">
      <Button
        color="warning"
        size="sm"
        disabled={playerUser.dropped || playerUser.voteCancel || playerUser.quit}
        on:click={voteCancel}
      >
        Vote to cancel
      </Button>
      {#if game.players.some((pl) => !!pl.dropped)}
        <Button size="sm" class="ml-2" disabled={playerUser.dropped || playerUser.quit} on:click={quit}>Quit</Button>
      {/if}
      {#each game.players as player}
        {#if remainingTime(player) <= 0 && isCurrentPlayer(player._id) && !player.dropped && !player.quit}
          <Button
            size="sm"
            class="ml-2"
            color="danger"
            disabled={requestedDrop[player._id]}
            on:click={() => requestDrop(player._id)}
          >
            Drop {player.name}
          </Button>
        {/if}
      {/each}
    </div>
  {/if}
  {#if gameInfo.settings.length > 0 && game.status === "active" && settings}
    <div class="mt-75">
      <h3>
        Settings
        <a href={`/page/${game.game.name}/settings`}>
          <Icon name="info-circle-fill" class="small" />
        </a>
      </h3>
      {#each gameInfo.settings as setting}
        {#if !setting.faction || setting.faction === playerUser.faction}
          {#if setting.type === "checkbox"}
            <Checkbox bind:checked={settings[setting.name]} on:change={postSettings}>
              {setting.label}
            </Checkbox>
          {:else if setting.type === "select"}
            <FormGroup class="d-flex align-items-center mt-2">
              <Label class="nowrap mr-2 mb-0">{@html oneLineMarked(setting.label)}</Label>
              <Input type="select" bind:value={settings[setting.name]} on:change={postSettings}>
                {#each setting.items as item}
                  <option value={item.name}>{item.label}</option>
                {/each}
              </Input>
            </FormGroup>
          {/if}
        {/if}
      {/each}
    </div>
  {/if}
  {#if showPreferences}
    <div class="mt-75">
      <h3>
        Preferences
        <a href={`/page/${game.game.name}/preferences`}>
          <Icon name="info-circle-fill" class="small" />
        </a>
      </h3>
      <PreferencesChooser game={gameInfo} />
    </div>
  {/if}

  <div class="mt-75">
    <div class="d-flex align-items-baseline">
      <h3 class="mb-0">Notes</h3>
      <div class="ml-2" style="font-size: smaller">
        (<a href="#" style="font-weight: unset !important" on:click|preventDefault={toggleNotes}
          >{showNotes ? "hide" : "show"}</a
        >)
      </div>
    </div>

    <Input
      type="textarea"
      class={"mt-2 vertical-textarea" + (!showNotes ? " d-none" : "")}
      bind:value={notes}
      on:input={updateNotesDebounce}
      rows="3"
      max-rows="8"
      placeholder="You can make plans here..."
      disabled={!$user || !notesLoaded}
    />
  </div>

  {#if gameInfo.expansions?.length > 0}
    <div class="mt-75">
      <h3>Expansions</h3>
      {#each game.game.expansions as expansion}
        <Badge color="info" class="mr-1">
          {gameInfo.expansions.find((xp) => xp.name === expansion)?.label}
        </Badge>
      {/each}
    </div>
  {/if}

  {#if log.length > 0}
    <div class="mt-75 thin-scrollbar">
      <div class="d-flex align-items-baseline">
        <h3 class="mb-0">Log</h3>
        <div class="ml-2" style="font-size: smaller">
          (<a href="#" style="font-weight: unset !important" on:click|preventDefault={toggleShowLog}>
            {showLog ? "hide" : "show"}
          </a>)
        </div>
      </div>
      {#if showLog}
        <div class="log mt-2">
          {#each log as item}
            <div>
              {@html logToHtml(item)}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if gameInfo.viewer?.replayable}
    <div class="mt-75">
      {#if !replayData}
        <Button color="info" size="sm" on:click={startReplay}>Replay</Button>
      {:else}
        <div class="d-flex align-items-center">
          <Button size="sm" class="mr-1" on:click={() => replayTo(replayData.start)}>
            <Icon name="skip-backward-fill" />
          </Button>
          <Button size="sm" class="mx-1" on:click={() => replayTo(Math.max(replayData.start, replayData.current - 1))}>
            <Icon name="skip-start-fill" />
          </Button>
          <span
            class="mx-1 text-center"
            style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex-grow: 1"
          >
            {replayData.current} / {replayData.end}
          </span>
          <Button size="sm" class="mx-1" on:click={() => replayTo(Math.min(replayData.end, replayData.current + 1))}>
            <Icon name="skip-end-fill" />
          </Button>
          <Button size="sm" class="mx-1" on:click={() => replayTo(replayData.end)}
            ><Icon name="skip-forward-fill" /></Button
          >
          <Button size="sm" class="ml-1" on:click={endReplay}><Icon name="stop-fill" color="danger" /></Button>
        </div>
      {/if}
    </div>
  {/if}

  {#if gameInfo.options.some((x) => !!game.game.options?.[x.name])}
    <div class="mt-75">
      <h3>Setup options</h3>
      {#each gameInfo.options.filter((x) => !!game.game.options[x.name]) as pref}
        <Badge color="secondary" class="mr-1">
          {#if pref.type === "checkbox"}
            {@html oneLineMarked(pref.label)}
          {:else if pref.type === "select" && pref.items && pref.items.some((x) => x.name === game.game.options[pref.name])}
            {@html oneLineMarked(
              pref.label + ": " + pref.items.find((x) => x.name === game.game.options[pref.name])?.label
            )}
          {/if}
        </Badge>
      {/each}
    </div>
  {/if}
</Portal>

<style lang="postcss" global>
  .your-turn {
    color: #25ee25;
  }

  .vertical-textarea {
    resize: vertical;
  }

  #sidebar {
    .player-row.active .player-name {
      color: #25ee25 !important;
    }
    .player-name {
      &.dropped {
        text-decoration: line-through;
      }
    }
    .player-avatar {
      width: 1.8em;
      height: 1.8em;

      &.active {
        box-shadow: 0 0 3px #25ee25;
      }

      .vp {
        z-index: 100;
        width: 18px;
        border-radius: 5px;
        font-size: 0.6em;

        &.online {
          background-color: #25ee25;
        }

        &.away {
          background-color: orange;
        }
      }
    }

    .log {
      height: 300px;
      overflow-y: scroll;

      margin-top: 4px;
      padding-left: 12px;
      border: 1px solid rgb(51, 51, 51);
      border-radius: 8px;
      padding-right: 12px;
    }
  }
</style>
