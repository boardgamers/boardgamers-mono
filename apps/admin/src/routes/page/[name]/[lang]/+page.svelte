<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { untrack } from "svelte";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadPages } from "$lib/stores.svelte.ts";
	import PageEdit from "$components/PageEdit.svelte";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";
	import type { PageData } from "./+page.ts";

	let { data }: PageProps = $props();

	const name = $derived(data.value?._id.name ?? "");
	const lang = $derived(data.value?._id.lang ?? "");

	// Editable (bind:value into PageEdit); re-synced from load data by the $effect.
	// eslint-disable-next-line svelte/prefer-writable-derived -- PageEdit mutates `value` via bind:value; it is not purely derived from `data`.
	let value = $state<PageData | null>(untrack(() => data.value));

	$effect(() => {
		value = data.value;
	});

	async function save(saveData: NonNullable<PageData>) {
		try {
			await api.put(`/admin/page/${name}/${lang}`, saveData);
			toast.success("Page saved");
			await loadPages();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save");
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
		<PageEdit mode="edit" bind:value onsave={save} ondelete={remove} />
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
