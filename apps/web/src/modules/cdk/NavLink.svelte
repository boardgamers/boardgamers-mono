<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Pathname, ResolvedPathname } from "$app/types";
	import { classnames } from "@/utils";

	let {
		active = false,
		disabled = false,
		href = "#",
		class: className = "",
		children,
		onclick,
		...rest
	}: {
		active?: boolean;
		disabled?: boolean;
		href?: Pathname | ResolvedPathname | `#${string}` | `?${string}` | `http${string}`;
		class?: string;
		children?: import("svelte").Snippet;
		onclick?: (e: MouseEvent) => void;
		[key: string]: any;
	} = $props();

	let classes = $derived(
		classnames(
			"px-3 py-2 rounded-md no-underline hover:bg-white/10",
			active ? "bg-primary text-white" : "",
			disabled ? "opacity-50 pointer-events-none" : "",
			className
		)
	);

	// Default href="#" means the link is used as a button (tab toggle, logout, …): don't
	// actually navigate to "#" (which would append "/#" to the URL). Real hrefs navigate
	// normally unless the handler prevents it.
	function handleClick(e: MouseEvent) {
		if (href === "#") {
			e.preventDefault();
		}
		onclick?.(e);
	}
</script>

<!-- resolve() only applies to plain pathnames; "#" (tab toggles), "?query" and external -->
<!-- http(s) hrefs pass through as-is. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a
	href={href.startsWith("#") || href.startsWith("?") || href.startsWith("http") ? href : resolve(href as Pathname)}
	class={classes}
	aria-disabled={disabled || undefined}
	onclick={handleClick}
	{...rest}
>
	{@render children?.()}
</a>
<!-- eslint-enable svelte/no-navigation-without-resolve -->
