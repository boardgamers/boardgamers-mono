<script lang="ts">
	import MarkdownEditor from "./MarkdownEditor.svelte";
	import { trim } from "$lib/actions.ts";
	import { locales } from "@bgs/models/locale";

	interface PageData {
		_id: { name: string; lang: string };
		title: string;
		content: string;
		translatedFrom?: { lang: string; updatedAt: string | Date };
	}

	interface Props {
		mode: "new" | "edit";
		value: PageData;
		onsave: (data: PageData) => void;
		ondelete?: () => void;
		// LLM auto-translate (#306): passed by the edit route; the component
		// renders the Translate… control only in edit mode when it's set.
		ontranslate?: (targetLang: string) => Promise<void> | void;
		// Bulk variant (#306): translate this page into every supported locale
		// where it's missing or outdated.
		ontranslateAll?: () => Promise<void> | void;
		// Current updatedAt of the source version this page was translated
		// from — when newer than translatedFrom.updatedAt, the translation is
		// outdated and a banner is shown.
		sourceUpdatedAt?: string | Date | null;
	}

	let {
		mode,
		value = $bindable(),
		onsave,
		ondelete,
		ontranslate,
		ontranslateAll,
		sourceUpdatedAt = null,
	}: Props = $props();

	// Outdated (#306): the source version was updated after this translation
	// was produced from it.
	const outdated = $derived(
		!!(
			value.translatedFrom &&
			sourceUpdatedAt &&
			new Date(sourceUpdatedAt).getTime() > new Date(value.translatedFrom.updatedAt).getTime()
		)
	);

	// Every supported UI locale except the page's own language.
	const targetLangs = $derived(locales.filter((l) => l !== value._id.lang));
	let targetLang = $state("");
	let translating = $state(false);

	// Keep the selection valid when the page's language changes (another page
	// loaded into the same editor).
	$effect(() => {
		if (!targetLangs.includes(targetLang as (typeof targetLangs)[number])) {
			targetLang = targetLangs[0] ?? "";
		}
	});

	async function translate() {
		if (!ontranslate || translating || !targetLang) return;
		translating = true;
		try {
			await ontranslate(targetLang);
		} finally {
			translating = false;
		}
	}

	let translatingAll = $state(false);

	async function translateAll() {
		if (!ontranslateAll || translatingAll) return;
		translatingAll = true;
		try {
			await ontranslateAll();
		} finally {
			translatingAll = false;
		}
	}
</script>

<div class="space-y-5">
	{#if mode === "edit" && outdated && value.translatedFrom}
		<div
			class="px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300"
		>
			Source ({value.translatedFrom.lang}) updated since this translation — {new Date(
				value.translatedFrom.updatedAt
			).toLocaleString()}. Review and re-translate or save to mark it manually maintained.
		</div>
	{/if}
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
				<select
					id="page-translate-lang"
					bind:value={targetLang}
					class="px-2 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				>
					{#each targetLangs as lang (lang)}
						<option value={lang}>{lang}</option>
					{/each}
				</select>
				<button
					onclick={translate}
					disabled={translating || !targetLang}
					title="Auto-translate this page with an LLM and open the translated version"
					class="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium disabled:opacity-50"
				>
					{translating ? "Translating…" : "Translate…"}
				</button>
				{#if ontranslateAll}
					<button
						onclick={translateAll}
						disabled={translatingAll}
						title="LLM-translate this page into every supported language where it's missing or outdated"
						class="px-4 py-2.5 bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-800 hover:bg-violet-200 dark:hover:bg-violet-900 rounded-lg font-medium disabled:opacity-50"
					>
						{translatingAll ? "Translating…" : "Translate to all languages"}
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
