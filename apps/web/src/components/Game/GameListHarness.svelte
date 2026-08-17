<!-- Test harness: mounts a single persistent <GameList> whose boardgameId/userId are
     driven by writable stores so a spec can change the props *in place* — reproducing
     SvelteKit's component reuse when navigating /boardgame/[id]/games → another id
     (same route component, new param, so `$state` inside GameList persists). -->
<script lang="ts" module>
	import { writable } from "svelte/store";
	import type { SetupOptionFilter } from "@/lib/games.svelte";
	export const harBoardgameId = writable<string | undefined>(undefined);
	export const harUserId = writable<string | undefined>(undefined);
	export const harOptionFilter = writable<SetupOptionFilter | undefined>(undefined);
</script>

<script lang="ts">
	import { untrack } from "svelte";
	import GameList from "./GameList.svelte";
	import { provideGameInfos, type GameInfoMap } from "@/lib/game-info.svelte";

	let {
		gameStatus = "open",
		title = "Harness",
		gameInfos = undefined,
	}: { gameStatus?: "open" | "active" | "ended"; title?: string; gameInfos?: GameInfoMap | undefined } = $props();

	// Specs that exercise game-info-dependent rendering (setup-option badges) provide
	// the list context here — setContext must run during component init, so it can't
	// be called from the spec body after mount. untrack: the map is read once at init.
	const initialGameInfos = untrack(() => gameInfos);
	if (initialGameInfos) {
		provideGameInfos(initialGameInfos);
	}
</script>

<GameList {gameStatus} {title} boardgameId={$harBoardgameId} userId={$harUserId} optionFilter={$harOptionFilter} />
