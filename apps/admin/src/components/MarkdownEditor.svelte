<script lang="ts">
	import { marked } from "marked";

	interface Props {
		value: string;
		label?: string;
		rows?: number;
	}

	let { value = $bindable(), label = "Content", rows = 15 }: Props = $props();

	let showPreview = $state(false);
	const html = $derived(marked(value || ""));
</script>

<div class="space-y-2">
	<div class="flex items-center justify-between">
		<label class="block text-sm font-medium">{label}</label>
		<button
			type="button"
			onclick={() => (showPreview = !showPreview)}
			class="text-xs font-medium text-blue-600 hover:text-blue-500"
		>
			{showPreview ? "Edit" : "Preview"}
		</button>
	</div>

	{#if showPreview}
		<div
			class="prose dark:prose-invert prose-sm max-w-none px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 min-h-[10rem]"
		>
			{@html html}
		</div>
	{:else}
		<textarea
			bind:value
			{rows}
			class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
		></textarea>
	{/if}
</div>
