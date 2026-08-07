<script lang="ts">
	import type { Pathname, ResolvedPathname } from "$app/types";
	import { classnames } from "@/utils";

	let {
		href = "#",
		first = false,
		previous = false,
		next = false,
		last = false,
		arialabel = undefined,
		class: className = "",
		children,
		onclick,
		...rest
	}: {
		href?: Pathname | ResolvedPathname | `#${string}`;
		first?: boolean;
		previous?: boolean;
		next?: boolean;
		last?: boolean;
		arialabel?: string;
		class?: string;
		children?: import("svelte").Snippet;
		onclick?: (e: MouseEvent) => void;
		[key: string]: any;
	} = $props();

	let classes = $derived(
		classnames(
			"inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700",
			className
		)
	);

	// Pagination uses these glyphs for first/prev/next/last.
	let defaultContent = $derived(first ? "«" : previous ? "‹" : next ? "›" : last ? "»" : undefined);
</script>

<!-- href rendered as-is (Pagination already resolve()'s the route). Not re-resolved: with -->
<!-- paths.relative (SvelteKit default) resolve() yields a relative URL and re-resolving throws. -->
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href is already resolve()'d by callers; re-resolving a paths.relative result throws -->
<a {href} class={classes} aria-label={arialabel} {onclick} {...rest}>
	{@render children?.()}
	{#if defaultContent !== undefined && !children}{defaultContent}{/if}
</a>
