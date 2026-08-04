<script lang="ts">
	import type { GameInfoFront } from "@bgs/models";
	import { classnames } from "@/utils";
	import IconGithub from "./icons/IconGithub.svelte";
	import IconDice from "./icons/IconDice.svelte";
	import IconCart from "./icons/IconCart.svelte";

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
				{ key: "bgg", label: "BGG", icon: IconDice },
				{ key: "publisher", label: "Publisher", icon: undefined },
				{ key: "buy", label: "Buy", icon: IconCart },
			] as const
		)
			.map((entry) => ({ ...entry, url: links?.[entry.key] }))
			.filter((entry) => !!entry.url)
	);
</script>

{#if entries.length > 0}
	<div class={classnames("flex flex-wrap items-center justify-center gap-x-4 gap-y-1", className)}>
		{#each entries as entry (entry.key)}
			<a
				href={entry.url}
				target="_blank"
				rel="external noopener noreferrer"
				class="inline-flex items-center gap-1.5 text-sm no-underline text-gray-600 hover:text-primary dark:text-gray-400 dark:hover:text-primary-lighter"
			>
				{#if entry.icon}
					<entry.icon />
				{/if}
				{entry.label}
			</a>
		{/each}
	</div>
{/if}
