<script lang="ts">
import { boardgameInfo, get } from "@/api";
import { loadGameData } from "@/api/game";

  import Loading from "@/modules/cdk/Loading.svelte";
import { navigate } from "@/modules/router";
import { gameSettings, user } from "@/store";
import { handleError } from "@/utils";
  import type { IGame } from "@lib/game";
  export let game: IGame
  let gameInfo = boardgameInfo(game.game.name, game.game.version);
  let stateSent = false;
  let log: string[] = []

  const resourcesLink = location.hostname === "localhost" || location.hostname.endsWith("gitpod.io") ? `/resources` : `//resources.${location.hostname.slice(location.hostname.indexOf(".") + 1)}`;

  const gameIframe = () => document.querySelector<HTMLIFrameElement>("#game-iframe")

  $: src = `${resourcesLink}/game/${gameInfo._id.game}/${gameInfo._id.version}/iframe?alternate=${
    $gameSettings[game.game.name]?.preferences?.alternateUI ? 1 : 0
  }`

  function postUser() {
    if (gameIframe()) {
      const index = game.players.findIndex((pl) => pl._id === $user?._id);
      const message = { type: "player", player: { index: index !== -1 ? index : undefined } };
      gameIframe()!.contentWindow?.postMessage(message, "*");
    }
  }

  $: postUser(), [user]
  $: prefs = $gameSettings[game.game.name]
  $: postPreferences(), [prefs]

  
  function postGamedata() {
    gameIframe()?.contentWindow?.postMessage({ type: "state", state: game.data }, "*");
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
        // await this.addMove(event.data.move);
      } else if (event.data.type === "displayReady") {
        stateSent = true;
      } else if (event.data.type === "fetchState") {
        await loadGameData(game._id).then(g => game = g);
        postGamedata();
      } else if (event.data.type === "fetchLog") {
        const logData = await get(`/gameplay/${game._id}/log`, { params: event.data.data })
          .then((r) => r.data);
        postGameLog(logData);
      } else if (event.data.type === "addLog") {
        log.push(...event.data.data);
      } else if (event.data.type === "replaceLog") {
        log = event.data.data;
      } else if (event.data.type === "replay:info") {
        // this.replayData = event.data.data;
      }
    } catch (err) {
      handleError(err);
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
