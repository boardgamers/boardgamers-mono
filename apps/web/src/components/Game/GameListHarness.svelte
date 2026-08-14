<!-- Test harness: mounts a single persistent <GameList> whose boardgameId/userId are
     driven by writable stores so a spec can change the props *in place* — reproducing
     SvelteKit's component reuse when navigating /boardgame/[id]/games → another id
     (same route component, new param, so `$state` inside GameList persists). -->
<script lang="ts" module>
	import { writable } from "svelte/store";
	export const harBoardgameId = writable<string | undefined>(undefined);
	export const harUserId = writable<string | undefined>(undefined);
</script>

<script lang="ts">
	import GameList from "./GameList.svelte";

	let { gameStatus = "open", title = "Harness" }: { gameStatus?: "open" | "active" | "ended"; title?: string } =
		$props();
</script>

<GameList {gameStatus} {title} boardgameId={$harBoardgameId} userId={$harUserId} />
