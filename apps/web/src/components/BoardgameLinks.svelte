<script lang="ts">
	import type { GameInfoFront } from "@bgs/models";
	import { classnames } from "@/utils";
	import IconGithub from "./icons/IconGithub.svelte";
	import IconDice from "./icons/IconDice.svelte";
	import IconGlobe from "./icons/IconGlobe.svelte";
	import IconBoxArrowUpRight from "./icons/IconBoxArrowUpRight.svelte";

	let {
		links,
		class: className = "",
	}: {
		links: GameInfoFront["links"];
		class?: string;
	} = $props();

	const entries = $derived(
		(
			[
				{ key: "source", label: "Source code", icon: IconGithub },
				{ key: "bgg", label: "BoardGameGeek", icon: IconDice },
				{ key: "publisher", label: "Publisher website", icon: IconGlobe },
			] as const
		)
			.map((entry) => ({ ...entry, url: links?.[entry.key] }))
			.filter((entry) => !!entry.url)
	);
</script>

{#if entries.length > 0}
	<div class={classnames("inline-flex items-center gap-1", className)} role="group" aria-label="External links">
		{#each entries as entry (entry.key)}
			<a
				href={entry.url}
				target="_blank"
				rel="external noopener noreferrer"
				title="{entry.label} (opens in a new tab)"
				aria-label="{entry.label} (opens in a new tab)"
				class="inline-flex items-center gap-1 rounded-full px-1 py-1 text-sm text-gray-500 no-underline transition-colors hover:bg-gray-100 hover:text-primary sm:px-2 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-primary-lighter"
			>
				<entry.icon size="0.95em" />
				<IconBoxArrowUpRight size="0.6em" class="opacity-60" />
			</a>
		{/each}
	</div>
{/if}
