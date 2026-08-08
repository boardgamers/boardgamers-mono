<script lang="ts">
	import { webHost } from "$lib/utils.ts";
	import type { Snippet } from "svelte";

	let { path, children }: { path: string; children?: Snippet } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external link to the public site (absolute URL), not an app route -->
<a href="{webHost()}{path}" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 hover:underline">
	{#if children}{@render children()}{:else}View on site ↗{/if}
</a>
