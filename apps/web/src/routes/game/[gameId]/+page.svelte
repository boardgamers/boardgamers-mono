<script lang="ts">
	import { OpenGame, StartedGame, ChatRoom, YourTurnBanner } from "@/components";
	import type { GameFront } from "@bgs/models";
	import { getContext } from "svelte";
	import type { GameContext } from "./game-context";

	// Read the live game from the shared context (set by the layout), NOT page.data.game
	// (a stale SSR snapshot). This lets the page auto-transition from the lobby (OpenGame)
	// to the board (StartedGame) when the game starts, without a manual refresh.
	const context = getContext("game") as GameContext;
	let status = $derived(context.game?.status);
	let gameId = $derived(context.game?._id ?? "");
</script>

<YourTurnBanner />

{#if status === "open"}
	<OpenGame />
{:else}
	<StartedGame />
{/if}
<ChatRoom room={gameId} />
