<script lang="ts">
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
	<!-- The OG card is a fixed 1200x630 canvas that must bleed to the viewport edges;
	     the app's global stylesheet lives on the (app) layout, so body keeps its default
	     8px margin here unless we reset it. -->
	<style>
		html,
		body {
			margin: 0;
			padding: 0;
		}
	</style>
</svelte:head>

{@render children()}
