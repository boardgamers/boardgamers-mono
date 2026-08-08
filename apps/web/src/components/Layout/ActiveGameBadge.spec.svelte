<script lang="ts">
	import { activeGames } from "@/lib/stores.svelte";
	import type { UserFront } from "@bgs/models";

	// Minimal stand-in for the Appbar badge: same store derivation, no navbar/OAuth deps.
	// `user` is passed in (the badge only renders when logged in) instead of reading
	// page.data, which needs a full SvelteKit router context absent under vitest.
	let { user }: { user: UserFront | null } = $props();

	// Same rule as Appbar.svelte: the store is the single source of truth (seeded once
	// by the layout from SSR data, then kept live by the websocket). No page.data
	// fallback — a stale snapshot must never shadow a fresh (possibly empty) update.
	let myActiveGames = $derived($activeGames);
</script>

{#if user}
	<span id="active-game-count">{myActiveGames.length}</span>
{/if}
