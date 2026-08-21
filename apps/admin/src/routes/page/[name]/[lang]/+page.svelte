<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { untrack } from "svelte";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadPages } from "$lib/stores.svelte.ts";
	import PageEdit from "$components/PageEdit.svelte";
	import PageHistory from "$components/PageHistory.svelte";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";
	import type { PageData } from "./+page.ts";

	let { data }: PageProps = $props();

	// Params (not data.value) survive a 404: a missing translation opens as a
	// blank editor prefilled with the requested name+lang, ready to create.
	const name = $derived(data.params.name);
	const lang = $derived(data.params.lang);

	// Editable (bind:value into PageEdit); re-synced from load data by the $effect.
	// A missing page (404 in load) becomes a blank editor to create it.
	// eslint-disable-next-line svelte/prefer-writable-derived -- PageEdit mutates `value` via bind:value; it is not purely derived from `data`.
	let value = $state<PageData | null>(untrack(() => data.value ?? blankPage()));

	$effect(() => {
		value = data.value ?? blankPage();
	});

	function blankPage(): PageData {
		return { _id: { name: data.params.name, lang: data.params.lang }, title: "", content: "" };
	}

	async function save(saveData: NonNullable<PageData>) {
		try {
			await api.put(`/admin/page/${name}/${lang}`, saveData);
			toast.success("Page saved");
			await loadPages();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save");
		}
	}

	// LLM auto-translate (#306): translate this page into `targetLang` on the
	// server, then open the translated page for review.
	async function translate(targetLang: string) {
		try {
			await api.post(`/admin/page/${encodeURIComponent(name)}/${encodeURIComponent(lang)}/translate`, {
				targetLang,
			});
			toast.success(`Translated ${name} → ${targetLang}`);
			await loadPages();
			goto(resolve("/page/[name]/[lang]", { name, lang: targetLang }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Translation failed");
		}
	}

	async function remove() {
		if (!confirm(`Delete page ${name} (${lang})?`)) return;
		try {
			await api.del(`/admin/page/${name}/${lang}`);
			toast.success("Deleted");
			await loadPages();
			goto(resolve("/"));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete");
		}
	}

	// Load an archived version into the editor — restoring only happens on Save,
	// which itself is recorded in the history.
	function restore(restored: { title: string; content: string }) {
		if (!value) return;
		value.title = restored.title;
		value.content = restored.content;
		toast.success("Version loaded into the editor — save to apply the restore");
	}
</script>

{#if value}
	<div class="max-w-3xl">
		<div class="flex items-center gap-4 mb-6">
			<h2 class="text-xl font-bold">
				{value.title || value._id.name} <span class="text-gray-400 font-normal">({value._id.lang})</span>
			</h2>
			<div class="ml-auto text-sm">
				<WebLink path={`/page/${name.replaceAll(":", "/")}`} />
			</div>
		</div>
		{#if data.value}
			<PageEdit mode="edit" bind:value onsave={save} ondelete={remove} ontranslate={translate} />
			<PageHistory {name} {lang} onrestore={restore} />
		{:else}
			<p class="mb-5 text-sm text-amber-600 dark:text-amber-400">
				No {lang} version of this page yet — you're creating it.
			</p>
			<PageEdit mode="new" bind:value onsave={save} />
		{/if}
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
