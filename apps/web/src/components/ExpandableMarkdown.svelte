<script lang="ts">
	import marked from "marked";

	import SanitizedHtml from "./SanitizedHtml.svelte";

	let { markdown, lines = 5 }: { markdown?: string; lines?: number } = $props();

	let expanded = $state(false);

	const lineClamp: Record<number, string> = {
		3: "line-clamp-3",
		4: "line-clamp-4",
		5: "line-clamp-5",
		6: "line-clamp-6",
	};

	// SSR-friendly heuristic: show the toggle when the source is long enough to overflow
	// the clamp (DOM measurement would only work after hydration, causing a pop-in).
	let long = $derived((markdown ?? "").length > lines * 60);
</script>

<div class="prose dark:prose-invert max-w-none {expanded || !long ? '' : lineClamp[lines]}">
	<SanitizedHtml html={marked(markdown ?? "")} />
</div>
{#if long}
	<button
		type="button"
		class="mt-1 text-sm text-primary hover:underline dark:text-primary-lighter"
		onclick={(e) => {
			e.stopPropagation();
			expanded = !expanded;
		}}
	>
		{expanded ? "Show less" : "Read more"}
	</button>
{/if}
