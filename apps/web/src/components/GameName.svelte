<script lang="ts">
	import type { GameInfoFront } from "@bgs/models";
	import { gameBasedOn, gameDisplayName } from "@/utils/game-label";

	let { info, line = false }: { info: Pick<GameInfoFront, "label" | "alias"> | null | undefined; line?: boolean } =
		$props();

	let base = $derived(gameBasedOn(info));
</script>

{#if info}{gameDisplayName(info)}{#if base}{#if line}&nbsp;·&nbsp;{:else}<br />{/if}<span
			class="text-sm font-normal text-gray-500 dark:text-gray-400">{base} rules</span
		>{/if}{/if}
