<script lang="ts">
	import MarkdownEditor from "./MarkdownEditor.svelte";
	import { trim } from "$lib/actions.ts";

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
		// LLM auto-translate (#306): passed by the edit route; the component
		// renders the Translate… control only in edit mode when it's set.
		ontranslate?: (targetLang: string) => Promise<void> | void;
	}

	let { mode, value = $bindable(), onsave, ondelete, ontranslate }: Props = $props();

	let targetLang = $state("de");
	let translating = $state(false);

	async function translate() {
		if (!ontranslate || translating) return;
		translating = true;
		try {
			await ontranslate(targetLang.trim().toLowerCase());
		} finally {
			translating = false;
		}
	}
</script>

<div class="space-y-5">
	<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
		<div>
			<label class="block text-sm font-medium mb-1.5" for="page-name">Name (slug)</label>
			<input
				id="page-name"
				bind:value={value._id.name}
				use:trim
				disabled={mode === "edit"}
				class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
			/>
		</div>
		<div>
			<label class="block text-sm font-medium mb-1.5" for="page-lang">Language</label>
			<input
				id="page-lang"
				bind:value={value._id.lang}
				use:trim
				disabled={mode === "edit"}
				class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
			/>
		</div>
		<div>
			<label class="block text-sm font-medium mb-1.5" for="page-title">Title</label>
			<input
				id="page-title"
				bind:value={value.title}
				class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
			/>
		</div>
	</div>

	<MarkdownEditor bind:value={value.content} label="Content (Markdown)" />

	<div class="flex flex-wrap items-center gap-2 pt-2">
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
		{#if mode === "edit" && ontranslate}
			<div class="ml-auto flex items-center gap-2">
				<label for="page-translate-lang" class="text-sm text-gray-500 dark:text-gray-400">Translate to</label>
				<input
					id="page-translate-lang"
					bind:value={targetLang}
					use:trim
					maxlength="3"
					class="w-16 px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
				<button
					onclick={translate}
					disabled={translating || !targetLang.trim() || targetLang.trim().toLowerCase() === value._id.lang}
					title="Auto-translate this page with an LLM and open the translated version"
					class="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium disabled:opacity-50"
				>
					{translating ? "Translating…" : "Translate…"}
				</button>
			</div>
		{/if}
	</div>
</div>
