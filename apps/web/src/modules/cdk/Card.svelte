<script lang="ts">
	import { classnames } from "@/utils";
	import type { Snippet } from "svelte";

	let {
		header = "",
		headerContent,
		class: className = "",
		onclick,
		footer,
		children,
		...rest
	}: {
		header?: string;
		headerContent?: Snippet;
		class?: string;
		onclick?: (e: MouseEvent) => void;
		footer?: Snippet;
		children?: Snippet;
		[key: string]: any;
	} = $props();

	let classes = $derived(
		classnames(
			"flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800",
			className
		)
	);
</script>

<div class={classes} {onclick} {...rest}>
	{#if header || headerContent}
		<div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-center">
			{#if headerContent}{@render headerContent()}{:else}{header}{/if}
		</div>
	{/if}
	<div class="grow p-4">
		{@render children?.()}
	</div>
	{#if footer}
		<div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-center">
			{@render footer?.()}
		</div>
	{/if}
</div>
