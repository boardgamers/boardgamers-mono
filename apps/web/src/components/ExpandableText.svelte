<script lang="ts">
	import { m } from "@/lib/i18n/messages";

	let { text, lines = 5 }: { text: string; lines?: number } = $props();

	let expanded = $state(false);

	const lineClamp: Record<number, string> = {
		3: "line-clamp-3",
		4: "line-clamp-4",
		5: "line-clamp-5",
		6: "line-clamp-6",
	};

	// SSR-friendly heuristic: show the toggle when the source is long enough to overflow
	// the clamp (DOM measurement would only work after hydration, causing a pop-in).
	let long = $derived(text.length > lines * 60);
</script>

<p class="whitespace-pre-line {expanded || !long ? '' : lineClamp[lines]}">{text}</p>
{#if long}
	<button
		type="button"
		class="mt-1 text-sm text-primary hover:underline dark:text-primary-lighter"
		aria-expanded={expanded}
		onclick={(e) => {
			e.stopPropagation();
			expanded = !expanded;
		}}
	>
		{expanded ? m.markdown_showLess() : m.markdown_readMore()}
	</button>
{/if}
