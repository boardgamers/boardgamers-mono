<script lang="ts">
	import { classnames } from "@/utils";

	let {
		toggle = undefined,
		class: className = "",
		children,
		...rest
	}: {
		toggle?: () => void;
		class?: string;
		children?: import("svelte").Snippet;
		[key: string]: any;
	} = $props();

	let classes = $derived(
		classnames("flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700", className)
	);
</script>

<div class={classes} {...rest}>
	{@render children?.()}
	{#if toggle}
		<!-- -m-2 expands the hit area to 44px (mobile touch target) without growing the header -->
		<button
			type="button"
			class="-m-2 ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
			aria-label="Close"
			onclick={toggle}
		>
			<span class="text-xl leading-none">&times;</span>
		</button>
	{/if}
</div>
