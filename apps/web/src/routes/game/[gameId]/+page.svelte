<script lang="ts">
	import { OpenGame, StartedGame, ChatRoom } from "@/components";
	import type { GameFront } from "@bgs/models";
	import { getContext } from "svelte";
	import type { GameContext } from "./game-context";
	import { provideGamePreferences } from "@/lib/game-preferences.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// SSR: provide this game's SSR-fetched prefs via context during init so descendants
	// (StartedGame, PreferencesChooser, UserGameSettings) render them server-side
	// (setContext must run at init; $effect does NOT run during SSR).
	const ssrPreferences = () => data.preferences;
	if (ssrPreferences()?.game) {
		provideGamePreferences({ [ssrPreferences()!.game]: ssrPreferences()! });
	}

	// Read the live game from the shared context (set by the layout), NOT page.data.game
	// (a stale SSR snapshot). This lets the page auto-transition from the lobby (OpenGame)
	// to the board (StartedGame) when the game starts, without a manual refresh.
	const context = getContext("game") as GameContext;
	let status = $derived(context.game?.status);
	let gameId = $derived(context.game?._id ?? "");
</script>

{#if status === "open"}
	<OpenGame />
{:else}
	<StartedGame />
{/if}
<ChatRoom room={gameId} />
