<script lang="ts">
	import type { GameFront, GamePreferencesFront } from "@bgs/models";
	import { Loading } from "@/modules/cdk";
	import type { GameContext } from "@/routes/game/[gameId]/game-context";
	import { createWatcher, handleError } from "@/utils";
	import { getContext, onDestroy, onMount, untrack } from "svelte";
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

	// Derive alternateUI straight from the store. The `prefs` chain (storedPrefs → addDefaults)
	// goes stale in the iframe component (a Svelte 5 chained-derived reactivity bug), so reading
	// `prefs.preferences.alternateUI` for the iframe src/key never updated on toggle. Reading the
	// store directly here recomputes reliably, which is what remounts the iframe live.
	const alternateUI = $derived.by(() => {
		const stored = $gamePreferences[gameName ?? ""] ?? ssrPrefs[gameName ?? ""];
		return Boolean(addDefaults(stored as GamePreferencesFront, context.gameInfo!)?.preferences?.alternateUI);
	});

	// The theme is only pushed via postMessage — baking `dark` into the src would make it
	// change with $currentTheme, and any src change reloads the iframe (and SSR/hydration
	// can't agree on its value anyway).
	let customUrl = $derived(
		$developerSettings
			? encodeURIComponent(
					$devGameSettings[gameInfoKey(context.gameInfo?._id.game ?? "", context.gameInfo?._id.version ?? 0)]
						?.viewerUrl ?? ""
				)
			: ""
	);
	let src = $derived.by(() => {
		if (!context.gameInfo) return "";
		return `${resourcesLink}/game/${gameName}/${context.gameInfo._id.version}/iframe?alternate=${
			alternateUI ? 1 : 0
		}&customViewerUrl=${customUrl}`;
	});

	// Key the iframe on the viewer identity so toggling "Use alternate UI" actually remounts it:
	// a same-element iframe whose `src` attribute changes is NOT reliably reloaded by the browser.
	// Deliberately NOT keyed on the raw `src`/`customViewerUrl`: those read `localStorage`-backed dev
	// settings (empty during SSR), so keying on them would remount the iframe right after hydration.
	// `alternateUI` and `gameId` are SSR/hydration-stable. The remounted viewer re-emits `gameReady`,
	// which re-runs the theme/user/preferences/avatars/state postMessage setup.
	let viewerKey = $derived(`${gameId}:${alternateUI ? 1 : 0}`);

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

	// The customViewerUrl dev override is intentionally NOT part of viewerKey (it's localStorage-backed,
	// empty during SSR — keying on it would remount the iframe right after hydration). So when it changes
	// (a dev edits the override, or hydration diverges from the SSR-rendered src), only the same-element
	// `src` attribute changes, which the browser won't reload. Reload it manually when the iframe's current
	// `src` no longer matches the target. No-op on the normal initial mount (attribute already === src).
	$effect(() => {
		customUrl;
		const iframe = untrack(() => gameIframe);
		if (iframe && src && iframe.getAttribute("src") !== src) {
			iframe.src = src;
		}
	});

	const onGameUpdated = createWatcher(() => {
		// The ws push carries the game's new `updatedAt` (the api's poll sends
		// `lastUpdate = updatedAt`, never later), so `>=` — a strict `>` never fires
		// and the update is dropped entirely (a cancelled game never left the sidebar).
		if (context.game && $lastGameUpdate >= new Date(context.game.updatedAt!)) {
			postUpdatePresent();
			// The viewer refetches its own state on `state:updated` (fetchState), but the
			// surrounding app — sidebar vote-cancel button, "Game ended!", OpenGame →
			// StartedGame transition, og:title — reads `context.game`, which only a fresh
			// load updates. Skip the refetch while a replay is live: replay navigation
			// owns the iframe's state then, and a `postGamedata()` would clobber it.
			if (gameId && !context.replayData) {
				loadGame(gameId).then((g) => {
					if (g._id === context.game?._id && !(g.updatedAt! < context.game.updatedAt!)) {
						context.game = g;
						postGamedata();
					}
				}, handleError);
			}
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

{#key viewerKey}
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
