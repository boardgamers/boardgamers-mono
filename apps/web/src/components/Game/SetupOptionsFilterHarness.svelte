<!-- Test harness: mounts a <SetupOptionsFilter> whose props are driven by writable
     stores so a spec can flip the pace filter and swap the games list *in place* —
     reproducing the lobby pages, where an active pace filter makes GameList bind
     back a same-pace (or empty) list while the chip visibility must stay anchored
     to the last unfiltered list. -->
<script lang="ts" module>
	import { writable } from "svelte/store";
	import type { GameFront, GameInfoFront } from "@bgs/models";
	import type { GamePace } from "@/utils";
	import type { SetupOptionFilter } from "@/lib/games.svelte";
	export const harGames = writable<GameFront[]>([]);
	export const harPace = writable<"" | GamePace>("");
	export const harInfo = writable<GameInfoFront | undefined>(undefined);
	export const harOptionFilter = writable<SetupOptionFilter | undefined>(undefined);
</script>

<script lang="ts">
	import SetupOptionsFilter from "./SetupOptionsFilter.svelte";
</script>

<SetupOptionsFilter games={$harGames} info={$harInfo} bind:pace={$harPace} bind:optionFilter={$harOptionFilter} />
