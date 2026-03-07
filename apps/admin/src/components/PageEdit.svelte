<script lang="ts">
	import MarkdownEditor from "./MarkdownEditor.svelte";

	interface PageData {
		_id: { name: string; lang: string };
		title: string;
		content: string;
	}

	interface Props {
		mode: "new" | "edit";
		value: PageData;
		onsave: (data: PageData) => void;
		ondelete?: () => void;
	}

	let { mode, value = $bindable(), onsave, ondelete }: Props = $props();
</script>

<div class="space-y-5">
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
		<div>
			<label class="block text-sm font-medium mb-1.5">Name (slug)</label>
			<input
				bind:value={value._id.name}
				disabled={mode === "edit"}
				class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
			/>
		</div>
		<div>
			<label class="block text-sm font-medium mb-1.5">Language</label>
			<input
				bind:value={value._id.lang}
				disabled={mode === "edit"}
				class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
			/>
		</div>
		<div>
			<label class="block text-sm font-medium mb-1.5">Title</label>
			<input
				bind:value={value.title}
				class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
			/>
		</div>
	</div>

	<MarkdownEditor bind:value={value.content} label="Content (Markdown)" />

	<div class="flex gap-2 pt-2">
		<button
			onclick={() => onsave(value)}
			class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
		>
			{mode === "new" ? "Create" : "Save"}
		</button>
		{#if mode === "edit" && ondelete}
			<button onclick={ondelete} class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium">
				Delete
			</button>
		{/if}
	</div>
</div>
