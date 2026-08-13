<script lang="ts">
	import type { GameFront, GamePreferencesFront } from "@bgs/models";
	import { Loading } from "@/modules/cdk";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";
	import { createWatcher, handleError } from "@/utils";
	import { getContext, onDestroy, onMount } from "svelte";
	import { loadGame } from "@/lib/game.svelte";
	import { get, post } from "@/lib/api";
	import {
		addDefaults,
		updatePreference,
		gamePreferences,
		useGamePreferencesFallback,
	} from "@/lib/game-preferences.svelte";
	import { gameInfoKey } from "@/lib/game-info.svelte";
	import { isDarkMode } from "@/lib/theme";
	import { account as user } from "@/lib/account.svelte";
	import { devGameSettings, developerSettings, lastGameUpdate } from "@/lib/stores.svelte";
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const context: GameContext = getContext("game");
	const { emitter } = context;
	let stateSent = $state(false);

	// Resolve the resources URL from SvelteKit's page state (real host on both server
	// and client). Previously this read window.location, which is empty during SSR and
	// produced a broken "//resources./game/..." src — fine on client-side navigation
	// but it left a direct page load stuck on the loading spinner forever.
	const host = $derived(page.url.host);
	const hostname = $derived(host.split(":")[0]);
	const resourcesLink = $derived(
		host.startsWith("localhost") || /^[\d.]+$/.test(hostname) || host.endsWith("boardgamers.space")
			? `/resources`
			: `//resources.${host.slice(host.indexOf(".") + 1)}`
	);

	let gameIframe = $state<HTMLIFrameElement>();

	let gameName = $derived(context.game?.game?.name);
	let gameId = $derived(context.game?._id);
	// Note: `prefs` is intentionally left unannotated — an explicit GamePreferencesFront
	// annotation/generic makes tsgo re-check the addDefaults call and drop the cast on
	// the store index expression below (tsgo contextual-typing bug).
	const ssrPrefs = useGamePreferencesFallback();
	const storedPrefs: GamePreferencesFront = $derived(
		($gamePreferences[gameName ?? ""] ?? ssrPrefs[gameName ?? ""]) as GamePreferencesFront
	);
	let prefs = $derived(addDefaults(storedPrefs, context.gameInfo!));

	// The theme is only pushed via postMessage — baking `dark` into the src would make it
	// change with $currentTheme, and any src change reloads the iframe (and SSR/hydration
	// can't agree on its value anyway).
	let src = $derived.by(() => {
		if (!context.gameInfo) return "";
		const customUrl = $developerSettings
			? encodeURIComponent(
					$devGameSettings[gameInfoKey(context.gameInfo._id.game, context.gameInfo._id.version)]?.viewerUrl ?? ""
				)
			: "";
		return `${resourcesLink}/game/${gameName}/${context.gameInfo._id.version}/iframe?alternate=${
			prefs?.preferences?.alternateUI ? 1 : 0
		}&customViewerUrl=${customUrl}`;
	});

	function postTheme() {
		gameIframe?.contentWindow?.postMessage({ type: "theme", dark: $isDarkMode }, "*");
	}

	function postUser() {
		const index = context.game?.players.findIndex((pl) => pl._id === $user?._id);
		const message = { type: "player", player: { index: index !== -1 ? index : undefined } };
		gameIframe?.contentWindow?.postMessage(message, "*");
	}

	// Bots have no account and no avatar image — show a robot emoji instead of a URL.
	function botAvatar(): string {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#c7c9d1"/><text x="50" y="68" font-size="52" text-anchor="middle">🤖</text></svg>`;
		return `data:image/svg+xml,${encodeURIComponent(svg)}`;
	}

	function postAvatars() {
		const avatars =
			context.game?.players.map((pl) =>
				pl.isBot ? botAvatar() : `${window.location.origin}/api/user/${pl._id}/avatar`
			) ?? [];
		gameIframe?.contentWindow?.postMessage({ type: "avatars", avatars: JSON.parse(JSON.stringify(avatars)) }, "*");
	}

	$effect(() => {
		$user;
		postUser();
	});

	$effect(() => {
		$isDarkMode;
		postTheme();
	});

	$effect(() => {
		prefs;
		postPreferences();
	});

	// Reset state when src or gameId changes
	$effect(() => {
		src;
		gameId;
		stateSent = false;
	});

	const onGameUpdated = createWatcher(() => {
		if (context.game && $lastGameUpdate > new Date(context.game.updatedAt!)) {
			postUpdatePresent();
		}
	});

	$effect(() => {
		$lastGameUpdate;
		onGameUpdated();
	});

	function postGamedata() {
		gameIframe?.contentWindow?.postMessage(
			{ type: "state", state: JSON.parse(JSON.stringify(context.game?.data)) },
			"*"
		);
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
			gameIframe.contentWindow?.postMessage(
				{ type: "preferences", preferences: JSON.parse(JSON.stringify(prefs.preferences)) },
				"*"
			);
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
				postTheme();
				postUser();
				postPreferences();
				postAvatars();
				postGamedata();
			} else if (event.data.type === "gameHeight") {
				if (!gameIframe) {
					return;
				}
				gameIframe.height = String(
					Math.max(
						+window.getComputedStyle(gameIframe, null).getPropertyValue("min-height").replace(/px/, ""),
						+event.data.height
					)
				);
			} else if (event.data.type === "playerClick") {
				goto(resolve("/(app)/user/[username]", { username: event.data.player.name }));
			} else if (event.data.type === "gameMove") {
				await addMove(event.data.move);
			} else if (event.data.type === "displayReady") {
				stateSent = true;
			} else if (event.data.type === "fetchState") {
				await loadGame(context.game?._id ?? "").then((g) => {
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
				if (context.game) {
					updatePreference(
						context.game.game.name,
						context.game.game.version,
						event.data.data.name,
						event.data.data.value
					);
				}
			}
		} catch (err) {
			handleError(err);
		}
	}

	async function addMove(move: string) {
		const { game: newGame, log } = await post<{ game: GameFront; log: LogObject }>(`/gameplay/${gameId}/move`, {
			move,
		});

		if (newGame._id === gameId && !(newGame.updatedAt! < context.game?.updatedAt!)) {
			context.game = newGame;
			postGameLog(log);
		}
	}

	// During SSR the iframe is ready before we are
	onMount(() => {
		gameIframe?.contentWindow?.postMessage({ type: "askReady" }, "*");
	});
</script>

<svelte:window onmessage={handleGameMessage} />

<Loading loading={!stateSent} />

{#key gameId}
	<iframe
		bind:this={gameIframe}
		allow="cross-origin-isolated fullscreen"
		{...{ credentialless: true } as any}
		id="game-iframe"
		title="Game UX"
		sandbox="allow-scripts allow-same-origin allow-orientation-lock"
		class:hidden={!stateSent}
		class:fullScreen={context.gameInfo?.viewer?.fullScreen}
		{src}
	></iframe>
{/key}

<style>
	#game-iframe {
		border: 0;
		width: 100%;
		margin-bottom: -6px;
		min-height: calc(100vh - var(--navbar-height));
	}

	/* Shows through the (transparent) iframe while the viewer loads, avoiding a white flash */
	:global(.dark) #game-iframe {
		background: rgb(3 7 18);
	}

	#game-iframe.fullScreen {
		max-height: calc(100vh - var(--navbar-height));
		height: calc(100vh - var(--navbar-height));
	}
</style>
