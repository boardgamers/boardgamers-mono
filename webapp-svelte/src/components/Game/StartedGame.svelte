<script lang="ts">
  import { get, post } from "@/api";
  import { loadGameData } from "@/api/game";

  import Loading from "@/modules/cdk/Loading.svelte";
  import { navigate } from "@/modules/router";
  import type { GameContext } from "@/pages/Game.svelte";
  import { gameSettings, lastGameUpdate, user } from "@/store";
  import { handleError, skipOnce } from "@/utils";
  import { getContext, onDestroy } from "svelte";

  const {game, replayData, gameInfo, emitter, log}: GameContext= getContext("game")
  let stateSent = false;

  const resourcesLink = location.hostname === "localhost" || location.hostname.endsWith("gitpod.io") ? `/resources` : `//resources.${location.hostname.slice(location.hostname.indexOf(".") + 1)}`;

  const gameIframe = () => document.querySelector<HTMLIFrameElement>("#game-iframe")

  $: src = `${resourcesLink}/game/${$gameInfo._id.game}/${$gameInfo._id.version}/iframe?alternate=${
    $gameSettings[$game.game.name]?.preferences?.alternateUI ? 1 : 0
  }`

  function postUser() {
    if (gameIframe()) {
      const index = $game.players.findIndex((pl) => pl._id === $user?._id);
      const message = { type: "player", player: { index: index !== -1 ? index : undefined } };
      gameIframe()!.contentWindow?.postMessage(message, "*");
    }
  }

  $: postUser(), [user]
  $: prefs = $gameSettings[$game.game.name]
  $: postPreferences(), [prefs]
  $: gameId = $game?._id

  onDestroy(lastGameUpdate.subscribe(skipOnce(() => {
    if ($game && $lastGameUpdate > new Date($game.updatedAt)) {
      postUpdatePresent()
    }
  })))
  
  function postGamedata() {
    gameIframe()?.contentWindow?.postMessage({ type: "state", state: $game.data }, "*");
  }

  function postUpdatePresent() {
    gameIframe()?.contentWindow?.postMessage({ type: "state:updated" }, "*");
  }

  function postGameLog(logObject: { start: number; end?: number; data: any }) {
    gameIframe()?.contentWindow?.postMessage({ type: "gameLog", data: logObject }, "*");
  }

  function postPreferences() {
    if (gameIframe()) {
      gameIframe()!.contentWindow?.postMessage({ type: "preferences", preferences: prefs.preferences }, "*");
    }
  }

  emitter.on('replay:start', () => {
    gameIframe()?.contentWindow?.postMessage({ type: "replay:start" }, "*");
  })

  emitter.on('replay:to', dest => {
    gameIframe()?.contentWindow?.postMessage({ type: "replay:to", to: dest }, "*");
  })

  emitter.on('replay:end', () => {
    gameIframe()?.contentWindow?.postMessage({ type: "replay:end" }, "*");
    $replayData = null
  })

  onDestroy(() => {
    emitter.off('replay:start');
    emitter.off('replay:to');
    emitter.off('replay:end');
  })

  async function handleGameMessage(event: MessageEvent) {
    try {
      console.log("receive event", event.data.type);
      if (event.data.type === "gameReady") {
        console.log("game ready, posting user & pref");
        postUser();
        postPreferences();
        postGamedata();
      } else if (event.data.type === "gameHeight") {
        gameIframe()!.height =
          String(
          Math.max(
            +window.getComputedStyle(gameIframe()!, null).getPropertyValue("min-height").replace(/px/, ""),
            +event.data.height
          ));
      } else if (event.data.type === "playerClick") {
        navigate("/user/" + encodeURIComponent(event.data.player.name));
      } else if (event.data.type === "gameMove") {
        await addMove(event.data.move);
      } else if (event.data.type === "displayReady") {
        stateSent = true;
      } else if (event.data.type === "fetchState") {
        await loadGameData($game._id).then(g => {
          if (g._id === $game?._id) {
            $game = g
            postGamedata();
          }
        });
      } else if (event.data.type === "fetchLog") {
        const logData = await get(`/gameplay/${$game._id}/log`, { params: event.data.data })
          .then((r) => r.data);
        postGameLog(logData);
      } else if (event.data.type === "addLog") {
        $log = [...$log, ...event.data.data];
      } else if (event.data.type === "replaceLog") {
        $log = event.data.data;
      } else if (event.data.type === "replay:info") {
        $replayData = event.data.data;
      }
    } catch (err) {
      handleError(err);
    }
  }

  async function addMove(move: string) {
    const { game: newGame, log } = await post(`/gameplay/${gameId}/move`, { move });

    if (newGame._id === gameId && !(newGame.updatedAt < $game?.updatedAt)) {
      $game = newGame
      postGameLog(log);
    }
  }

</script>

<svelte:window on:message={handleGameMessage} />

<Loading loading={!stateSent} />

<iframe id="game-iframe" title="Game UX" sandbox="allow-scripts allow-same-origin" class:d-none={!stateSent} {src} />

<style>
  #game-iframe {
    border: 0;
    width: calc(100% + 30px);
    margin-left: -15px;
    margin-right: -15px;
    margin-top: calc(0 - var(--navbar-margin));
    margin-bottom: -6px;
    min-height: calc(100vh - var(--navbar-height));
  }
</style>
