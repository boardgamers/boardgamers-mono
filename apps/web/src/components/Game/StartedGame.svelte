<script lang="ts">
  import type { GamePreferencesFront } from "@bgs/models";
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

  const context: GameContext = getContext("game");
  const { emitter } = context;
  let stateSent = $state(false);

  const host = browser ? window.location.host : "";
  const resourcesLink =
    host.startsWith("localhost") || host.endsWith("gitpod.io") || host.endsWith("boardgamers.space")
      ? `/resources`
      : `//resources.${host.slice(host.indexOf(".") + 1)}`;

  let gameIframe = $state<HTMLIFrameElement>();

  let src = $state("");

  let gameName = $derived(context.game?.game?.name);
  let gameId = $derived(context.game?._id);
  let prefs = $derived<GamePreferencesFront>(addDefaults($gamePreferences[gameName], context.gameInfo));

  function postUser() {
    const index = context.game?.players.findIndex((pl) => pl._id === $user?._id);
    const message = { type: "player", player: { index: index !== -1 ? index : undefined } };
    gameIframe?.contentWindow?.postMessage(message, "*");
  }

  function postAvatars() {
    const message = {
      type: "avatars",
      avatars: context.game?.players.map((pl) => `${window.location.origin}/api/user/${pl._id}/avatar`) ?? [],
    };
    gameIframe?.contentWindow?.postMessage(message, "*");
  }

  $effect(() => {
    $user;
    postUser();
  });

  $effect(() => {
    prefs;
    postPreferences();
  });

  const updateSrc = () => {
    if (context.gameInfo) {
      const customUrl = $developerSettings
        ? encodeURIComponent(
            $devGameSettings[gameInfoKey(context.gameInfo._id.game, context.gameInfo._id.version)]?.viewerUrl ?? ""
          )
        : "";

      src = `${resourcesLink}/game/${gameName}/${context.gameInfo._id.version}/iframe?alternate=${
        prefs?.preferences?.alternateUI ? 1 : 0
      }&customViewerUrl=${customUrl}`;
    }
  };

  $effect(() => {
    context.gameInfo;
    prefs;
    updateSrc();
  });

  const onSrcChanged = () => (stateSent = false);

  $effect(() => {
    src;
    gameId;
    onSrcChanged();
  });

  const onGameUpdated = createWatcher(() => {
    if (context.game && $lastGameUpdate > new Date(context.game.updatedAt)) {
      postUpdatePresent();
    }
  });

  $effect(() => {
    $lastGameUpdate;
    onGameUpdated();
  });

  function postGamedata() {
    gameIframe?.contentWindow?.postMessage({ type: "state", state: context.game?.data }, "*");
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
    context.replayData = null;
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
        await loadGame(context.game?._id).then((g) => {
          if (g._id === context.game?._id) {
            context.game = g;
            postGamedata();
          }
        });
      } else if (event.data.type === "fetchLog") {
        const logData = await get<LogObject>(`/gameplay/${context.game?._id}/log`, { params: event.data.data }).then(
          (r) => r.data
        );
        postGameLog(logData);
      } else if (event.data.type === "addLog") {
        context.log = [...context.log, ...event.data.data];
      } else if (event.data.type === "replaceLog") {
        context.log = event.data.data;
      } else if (event.data.type === "replay:info") {
        context.replayData = event.data.data;
      } else if (event.data.type === "updatePreference") {
        updatePreference(
          context.game?.game.name,
          context.game?.game.version,
          event.data.data.name,
          event.data.data.value
        );
      }
    } catch (err) {
      handleError(err);
    }
  }

  async function addMove(move: string) {
    const { game: newGame, log } = await post(`/gameplay/${gameId}/move`, { move });

    if (newGame._id === gameId && !(newGame.updatedAt < context.game?.updatedAt)) {
      context.game = newGame;
      postGameLog(log);
    }
  }

  // During SSR the iframe is ready before we are
  onMount(() => {
    gameIframe?.contentWindow?.postMessage({ type: "askReady" }, "*");
  });

  let description = $state<string>();
  let title = $state<string>();

  $effect(() => {
    if (context.game?.status === "active") {
      title = `${gameId} - ${gameLabel(context.gameInfo?.label)} game`;
      description = `Round ${context.game.context?.round ?? 0}

${context.game.players.map((pl) => `- ${pl.name} (${pl.score} pts)`).join("\n")}`;
    } else if (context.game?.cancelled) {
      title = `Cancelled - ${gameLabel(context.gameInfo?.label)} game`;
    } else if (context.game) {
      const victor = minBy(context.game.players, "ranking")!;
      title = `${victor.name}'s victory! - ${gameLabel(context.gameInfo?.label)} game`;
      description = sortBy(context.game.players, "ranking")
        .map((player) => `${player.ranking}° ${player.name} (${player.score}pts)`)
        .join("\n");
    }
  });
</script>

<SEO {title} {description} />

<svelte:window onmessage={handleGameMessage} />

<Loading loading={!stateSent} />

{#key gameId}
  <iframe
    bind:this={gameIframe}
    allow="cross-origin-isolated fullscreen"
    credentialless
    id="game-iframe"
    title="Game UX"
    sandbox="allow-scripts allow-same-origin allow-orientation-lock"
    class:d-none={!stateSent}
    class:fullScreen={context.gameInfo?.viewer?.fullScreen}
    {src}
  />
{/key}

<style>
  #game-iframe {
    border: 0;
    width: calc(100% + 24px);
    margin-left: -12px;
    margin-right: -12px;
    margin-top: -16px; /* calc(0 - var(--navbar-margin)) but doesn't seem to work */
    margin-bottom: -6px;
    min-height: calc(100vh - var(--navbar-height));
  }

  #game-iframe.fullScreen {
    max-height: calc(100vh - var(--navbar-height));
    height: calc(100vh - var(--navbar-height));
  }
</style>
