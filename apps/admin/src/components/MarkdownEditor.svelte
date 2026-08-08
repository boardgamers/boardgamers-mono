<script lang="ts">
	import { marked } from "marked";
	import createDOMPurify from "dompurify";

	interface Props {
		value: string | undefined;
		label?: string;
		rows?: number;
	}

	let { value = $bindable(), label = "Content", rows = 15 }: Props = $props();

	let showPreview = $state(false);
	// Admin-only app (ssr=false): DOMPurify hooks the ambient window lazily on first
	// sanitize. Content is admin-authored page markdown — sanitize before {@html}.
	const purify = createDOMPurify();
	const html = $derived(purify.sanitize(marked(value || "") as string));
</script>

<div class="space-y-2">
	<div class="flex items-center justify-between">
		<label class="block text-sm font-medium" for="md-content">{label}</label>
		<button
			type="button"
			onclick={() => (showPreview = !showPreview)}
			class="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-500 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950"
		>
			{showPreview ? "Edit" : "Preview"}
		</button>
	</div>

	{#if showPreview}
		<div
			class="prose dark:prose-invert prose-sm max-w-none px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-h-[10rem]"
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- `html` is DOMPurify-sanitized -->
			{@html html}
		</div>
	{:else}
		<textarea
			id="md-content"
			bind:value
			{rows}
			class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
		></textarea>
	{/if}
</div>
