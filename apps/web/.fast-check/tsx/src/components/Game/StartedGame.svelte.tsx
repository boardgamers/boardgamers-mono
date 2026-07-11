///<reference types="svelte" />
;
import type { GamePreferences } from "@bgs/models";
import { Loading } from "@/modules/cdk";
import type { GameContext } from "@/routes/game/[gameId]/game-context";
import { createWatcher, handleError } from "@/utils";
import { getContext, onDestroy, onMount } from "svelte";
import { loadGame } from "@/lib/game.svelte";
import { get, post } from "@/lib/api";
import { addDefaults, updatePreference, gamePreferences } from "@/lib/game-preferences.svelte";
import { gameInfoKey } from "@/lib/game-info.svelte";
import { account as user } from "@/lib/account.svelte";
import { devGameSettings, developerSettings, lastGameUpdate } from "@/lib/stores.svelte";
import { browser } from "$app/environment";
import SEO from "../SEO.svelte";
import { gameLabel } from "@/utils/game-label";
import { minBy, sortBy } from "lodash";
import { goto } from "$app/navigation";
function $$render() {
/*Ωignore_startΩ*/;let $gamePreferences = __sveltets_2_store_get(gamePreferences);;let $user = __sveltets_2_store_get(user);;let $devGameSettings = __sveltets_2_store_get(devGameSettings);;let $developerSettings = __sveltets_2_store_get(developerSettings);;let $lastGameUpdate = __sveltets_2_store_get(lastGameUpdate);/*Ωignore_endΩ*/
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  

  const { game, replayData, gameInfo, emitter, log }: GameContext = getContext("game")/*Ωignore_startΩ*/;let $game = __sveltets_2_store_get(game);;let $replayData = __sveltets_2_store_get(replayData);;let $gameInfo = __sveltets_2_store_get(gameInfo);;let $log = __sveltets_2_store_get(log);/*Ωignore_endΩ*/;
  let stateSent = false;

  const host = browser ? window.location.host : "";
  const resourcesLink =
    host.startsWith("localhost") ||
    host.endsWith("gitpod.io") ||
    host.endsWith("boardgamers.space")
      ? `/resources`
      : `//resources.${host.slice(host.indexOf(".") + 1)}`;

  let gameIframe: HTMLIFrameElement;

  let src = "";
  let prefs: GamePreferences;

  function postUser() {
    const index = $game.players.findIndex((pl) => pl._id === $user?._id);
    const message = { type: "player", player: { index: index !== -1 ? index : undefined } };
    gameIframe?.contentWindow?.postMessage(message, "*");
  }

  function postAvatars() {
    const message = {
      type: "avatars",
      avatars: $game.players.map((pl) => `${window.location.origin}/api/user/${pl._id}/avatar`),
    };
    gameIframe?.contentWindow?.postMessage(message, "*");
  }

  let  gameName = __sveltets_2_invalidate(() => $game?.game?.name);
  ;() => {$: (postUser(), [$user]);}
  $: prefs = __sveltets_2_invalidate(() => addDefaults($gamePreferences[gameName], $gameInfo));
  ;() => {$: (postPreferences(), [prefs]);}
  let  gameId = __sveltets_2_invalidate(() => $game?._id);

  const updateSrc = () => {
    if ($gameInfo) {
      const customUrl = $developerSettings
        ? encodeURIComponent($devGameSettings[gameInfoKey($gameInfo._id.game, $gameInfo._id.version)]?.viewerUrl ?? "")
        : "";

      src = `${resourcesLink}/game/${gameName}/${$gameInfo._id.version}/iframe?alternate=${
        prefs?.preferences?.alternateUI ? 1 : 0
      }&customViewerUrl=${customUrl}`;
    }
  };
  ;() => {$: (updateSrc(), [$gameInfo, prefs]);}

  const onSrcChanged = () => (stateSent = false);

  ;() => {$: (onSrcChanged(), [src, gameId]);}

  const onGameUpdated = createWatcher(() => {
    if ($game && $lastGameUpdate > new Date($game.updatedAt)) {
      postUpdatePresent();
    }
  });

  ;() => {$: (onGameUpdated(), [$lastGameUpdate]);}

  function postGamedata() {
    gameIframe?.contentWindow?.postMessage({ type: "state", state: $game.data }, "*");
  }

  function postUpdatePresent() {
    gameIframe?.contentWindow?.postMessage({ type: "state:updated" }, "*");
  }

  type LogObject = { start: number; end?: number; data: any };

  function postGameLog(logObject: LogObject) {
    gameIframe?.contentWindow?.postMessage({ type: "gameLog", data: logObject }, "*");
  }

  function postPreferences() {
    if (gameIframe && prefs) {
      gameIframe.contentWindow?.postMessage({ type: "preferences", preferences: prefs.preferences }, "*");
    }
  }

  emitter.on("replay:start", () => {
    gameIframe?.contentWindow?.postMessage({ type: "replay:start" }, "*");
  });

  emitter.on("replay:to", (dest: number) => {
    gameIframe?.contentWindow?.postMessage({ type: "replay:to", to: dest }, "*");
  });

  emitter.on("replay:end", () => {
    gameIframe?.contentWindow?.postMessage({ type: "replay:end" }, "*");
    $replayData = null;
  });

  onDestroy(() => {
    emitter.off("replay:start");
    emitter.off("replay:to");
    emitter.off("replay:end");
  });

  async function handleGameMessage(event: MessageEvent) {
    try {
      console.log("receive event", event.data.type);
      if (event.data.type === "gameReady") {
        console.log("game ready, posting user & pref");
        postUser();
        postPreferences();
        postAvatars();
        postGamedata();
      } else if (event.data.type === "gameHeight") {
        gameIframe.height = String(
          Math.max(
            +window.getComputedStyle(gameIframe, null).getPropertyValue("min-height").replace(/px/, ""),
            +event.data.height
          )
        );
      } else if (event.data.type === "playerClick") {
        goto("/user/" + encodeURIComponent(event.data.player.name));
      } else if (event.data.type === "gameMove") {
        await addMove(event.data.move);
      } else if (event.data.type === "displayReady") {
        stateSent = true;
      } else if (event.data.type === "fetchState") {
        await loadGame($game._id).then((g) => {
          if (g._id === $game?._id) {
            $game = g;
            postGamedata();
          }
        });
      } else if (event.data.type === "fetchLog") {
        const logData = await get<LogObject>(`/gameplay/${$game._id}/log`, { params: event.data.data }).then(
          (r) => r.data
        );
        postGameLog(logData);
      } else if (event.data.type === "addLog") {
        $log = [...$log, ...event.data.data];
      } else if (event.data.type === "replaceLog") {
        $log = event.data.data;
      } else if (event.data.type === "replay:info") {
        $replayData = event.data.data;
      } else if (event.data.type === "updatePreference") {
        updatePreference($game.game.name, $game.game.version, event.data.data.name, event.data.data.value);
      }
    } catch (err) {
      handleError(err);
    }
  }

  async function addMove(move: string) {
    const { game: newGame, log } = await post(`/gameplay/${gameId}/move`, { move });

    if (newGame._id === gameId && !(newGame.updatedAt < $game?.updatedAt)) {
      $game = newGame;
      postGameLog(log);
    }
  }

  // During SSR the iframe is ready before we are
  onMount(() => {
    gameIframe?.contentWindow?.postMessage({ type: "askReady" }, "*");
  });

  let description: string;
  let title: string;

  ;() => {$: {
    if ($game.status === "active") {
      title = `${gameId} - ${gameLabel($gameInfo.label)} game`;
      description = `Round ${$game.context?.round ?? 0}

${$game.players.map((pl) => `- ${pl.name} (${pl.score} pts)`).join("\n")}`;
    } else if ($game.cancelled) {
      title = `Cancelled - ${gameLabel($gameInfo.label)} game`;
    } else {
      const victor = minBy($game.players, "ranking")!;
      title = `${victor.name}'s victory! - ${gameLabel($gameInfo.label)} game`;
      description = sortBy($game.players, "ranking")
        .map((player) => `${player.ranking}° ${player.name} (${player.score}pts)`)
        .join("\n");
    }
  }}
;
async () => {

 { const $$_OES0C = __sveltets_2_ensureComponent(SEO); new $$_OES0C({ target: __sveltets_2_any(), props: {  title,description,}});}

 { svelteHTML.createElement("svelte:window", {   "on:message":handleGameMessage,});}

 { const $$_gnidaoL0C = __sveltets_2_ensureComponent(Loading); new $$_gnidaoL0C({ target: __sveltets_2_any(), props: {  "loading":!stateSent,}});}

gameId; {
   { const $$_iframe0 = svelteHTML.createElement("iframe", {              "allow":`cross-origin-isolated fullscreen`,"credentialless":true,"id":`game-iframe`,"title":`Game UX`,"sandbox":`allow-scripts allow-same-origin allow-orientation-lock`,src,});gameIframe = $$_iframe0;!stateSent;$gameInfo.viewer?.fullScreen;}
}


};
return { props: {} as Record<string, never>, exports: {}, bindings: "", slots: {}, events: {} }}
const StartedGame__SvelteComponent_ = __sveltets_2_isomorphic_component(__sveltets_2_with_any_event($$render()));
/*Ωignore_startΩ*/type StartedGame__SvelteComponent_ = InstanceType<typeof StartedGame__SvelteComponent_>;
/*Ωignore_endΩ*/export default StartedGame__SvelteComponent_;