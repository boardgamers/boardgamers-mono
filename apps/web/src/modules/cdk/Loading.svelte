<script lang="ts">
	import Spinner from "./Spinner.svelte";
	import type { Snippet } from "svelte";

	let {
		loading = false,
		class: className = "",
		children,
	}: {
		loading?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

{#if loading}
	<div class="flex min-h-[50vh] items-center justify-center"><Spinner color="secondary" /></div>
{:else if className}
	<!-- Wrapping div only when a class is passed (e.g. min-w-0 in a grid); otherwise render
	the children directly so existing usages keep their exact DOM. -->
	<div class={className}>{@render children?.()}</div>
{:else}
	{@render children?.()}
{/if}
