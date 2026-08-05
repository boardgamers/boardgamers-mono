<script lang="ts">
	import type { Pathname, ResolvedPathname } from "$app/types";
	import { classnames } from "@/utils";

	let {
		href = "#",
		disabled = false,
		class: className = "",
		children,
		onclick,
		...rest
	}: {
		href?: Pathname | ResolvedPathname | `#${string}`;
		disabled?: boolean;
		class?: string;
		children?: import("svelte").Snippet;
		onclick?: (e: MouseEvent) => void;
		[key: string]: any;
	} = $props();

	let classes = $derived(
		classnames(
			"block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer",
			disabled ? "opacity-50 pointer-events-none" : "",
			className
		)
	);

	function handleClick(e: MouseEvent) {
		if (disabled) {
			e.preventDefault();
			return;
		}
		onclick?.(e);
	}
</script>

<!-- href is rendered as-is (callers pass resolve()'d routes or "#"). Not re-resolved: with -->
<!-- paths.relative (SvelteKit default) resolve() yields a relative URL and re-resolving throws. -->
<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href is already resolve()'d by callers; re-resolving a paths.relative result throws -->
<a {href} class={classes} aria-disabled={disabled || undefined} onclick={handleClick} {...rest}>
	{@render children?.()}
</a>
