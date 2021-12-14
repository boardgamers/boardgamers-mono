<script lang="ts">
  import type { GamePreferences } from "@bgs/types";
  import { Loading } from "@/modules/cdk";
  import { navigate } from "@/modules/router";
  import type { GameContext } from "@/pages/Game.svelte";
  import { createWatcher, handleError } from "@/utils";
  import { getContext, onDestroy, onMount } from "svelte";
  import { useGame } from "@/composition/useGame";
  import { useRest } from "@/composition/useRest";
  import { useGamePreferences } from "@/composition/useGamePreferences";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { useAccount } from "@/composition/useAccount";
  import { useDeveloperSettings } from "@/composition/useDeveloperSettings";
  import { useCurrentGame } from "@/composition/useCurrentGame";
  import { useSession } from "@/composition/useSession";

  const { session } = useSession();
  const { loadGame } = useGame();
  const { account: user } = useAccount();
  const { get, post } = useRest();
  const { addDefaults, updatePreference, gamePreferences } = useGamePreferences();
  const { gameInfoKey } = useGameInfo();
  const { lastGameUpdate } = useCurrentGame();
  const { devGameSettings, developerSettings } = useDeveloperSettings();

  const { game, replayData, gameInfo, emitter, log }: GameContext = getContext("game");
  let stateSent = false;

  const resourcesLink =
    session.host.startsWith("localhost") || session.host.endsWith("gitpod.io")
      ? `/resources`
      : `//resources.${session.host.slice(session.host.indexOf(".") + 1)}`;

  let gameIframe: HTMLIFrameElement;

  let src = "";
  let prefs: GamePreferences;

  function postUser() {
    if (gameIframe) {
      const index = $game.players.findIndex((pl) => pl._id === $user?._id);
      const message = { type: "player", player: { index: index !== -1 ? index : undefined } };
      gameIframe.contentWindow?.postMessage(message, "*");
    }
  }

  $: gameName = $game?.game.name;
  $: postUser(), [$user];
  $: prefs = addDefaults($gamePreferences[gameName], $gameInfo);
  $: postPreferences(), [prefs];
  $: gameId = $game?._id;

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
  $: updateSrc(), [$gameInfo, prefs];

  const onSrcChanged = () => (stateSent = false);

  $: onSrcChanged(), [src];

  const onGameUpdated = createWatcher(() => {
    if ($game && $lastGameUpdate > new Date($game.updatedAt)) {
      postUpdatePresent();
    }
  });

  $: onGameUpdated(), [$lastGameUpdate];

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
        postGamedata();
      } else if (event.data.type === "gameHeight") {
        gameIframe.height = String(
          Math.max(
            +window.getComputedStyle(gameIframe, null).getPropertyValue("min-height").replace(/px/, ""),
            +event.data.height
          )
        );
      } else if (event.data.type === "playerClick") {
        navigate("/user/" + encodeURIComponent(event.data.player.name));
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
</script>

<svelte:window on:message={handleGameMessage} />

<Loading loading={!stateSent} />

<iframe
  bind:this={gameIframe}
  id="game-iframe"
  title="Game UX"
  sandbox="allow-scripts allow-same-origin"
  class:d-none={!stateSent}
  {src}
/>

<style>
  #game-iframe {
    border: 0;
    width: calc(100% + 24px);
    margin-left: -12px;
    margin-right: -12px;
    margin-top: calc(0 - var(--navbar-margin));
    margin-bottom: -6px;
    min-height: calc(100vh - var(--navbar-height));
  }
</style>
