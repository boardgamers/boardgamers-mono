<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page as pageState } from "$app/state";
	import { untrack } from "svelte";
	import { api, pollBulkTranslateJob, startBulkTranslate } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadPages } from "$lib/stores.svelte.ts";
	import PageEdit from "$components/PageEdit.svelte";
	import PageHistory from "$components/PageHistory.svelte";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";
	import type { PageData } from "./+page.ts";

	let { data }: PageProps = $props();

	// The layout load already fetched every page (sidebar) — from it we know which
	// languages exist for this page name without an extra request.
	const allPages = $derived(pageState.data.pages ?? []);

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

	// Bulk variant (#306): this page into every supported locale where it's
	// missing or outdated, as a server-side job polled to completion.
	async function translateAll() {
		try {
			const jobId = await startBulkTranslate({ pageName: name });
			const job = await pollBulkTranslateJob(jobId);
			const summary = `Translated ${job.translated}, skipped ${job.skipped} up-to-date`;
			if (job.errors.length > 0) {
				toast.error(`${summary}, ${job.errors.length} error(s): ${job.errors[0].lang}`);
			} else {
				toast.success(summary);
			}
			await loadPages();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Translation failed");
		}
	}

	// Language to translate from when this page is missing in `lang`: English is
	// the source language, otherwise any existing version. null = nothing to
	// translate from → plain blank editor.
	const sourceLang = $derived.by((): string | null => {
		if (data.value) return null;
		const langs = new Set(allPages.filter((p) => p._id.name === name && p._id.lang !== lang).map((p) => p._id.lang));
		if (langs.has("en")) return "en";
		return [...langs].sort()[0] ?? null;
	});

	// Current updatedAt of the version this page was translated from (#306) —
	// PageEdit compares it against translatedFrom.updatedAt to flag the
	// translation as outdated.
	const sourceUpdatedAt = $derived.by(() => {
		const from = data.value?.translatedFrom;
		if (!from) return null;
		return allPages.find((p) => p._id.name === name && p._id.lang === from.lang)?.updatedAt ?? null;
	});

	let creatingFrom = $state(false);

	// Missing-translation view: translate the source version into `lang` on the
	// server (the endpoint upserts), then re-run load so the editor opens the
	// freshly created translation for review before saving.
	async function createFromSource() {
		if (!sourceLang || creatingFrom) return;
		creatingFrom = true;
		try {
			await api.post(`/admin/page/${encodeURIComponent(name)}/${encodeURIComponent(sourceLang)}/translate`, {
				targetLang: lang,
			});
			toast.success(`Translated ${name} → ${lang}`);
			await loadPages();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Translation failed");
		} finally {
			creatingFrom = false;
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
			<PageEdit
				mode="edit"
				bind:value
				onsave={save}
				ondelete={remove}
				ontranslate={translate}
				ontranslateAll={translateAll}
				{sourceUpdatedAt}
			/>
			<PageHistory {name} {lang} onrestore={restore} />
		{:else}
			<div class="mb-5 flex flex-wrap items-center gap-3 text-sm text-amber-600 dark:text-amber-400">
				<p>No {lang} version of this page yet — you're creating it.</p>
				{#if sourceLang}
					<button
						onclick={createFromSource}
						disabled={creatingFrom}
						title="Auto-translate the {sourceLang} version with an LLM and open it here for review"
						class="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-medium disabled:opacity-50"
					>
						{creatingFrom ? "Translating…" : `Create from ${sourceLang} (translate)`}
					</button>
				{/if}
			</div>
			<PageEdit mode="new" bind:value onsave={save} />
		{/if}
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
