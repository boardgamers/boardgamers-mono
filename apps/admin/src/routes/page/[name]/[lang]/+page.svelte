<script lang="ts">
	import { goto } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadPages } from "$lib/stores.svelte.ts";
	import PageEdit from "$components/PageEdit.svelte";
	import type { PageData } from "./+page.ts";

	let { data }: { data: { value: PageData | null } } = $props();

	const name = data.value?._id.name ?? "";
	const lang = data.value?._id.lang ?? "";

	let value = $state<PageData | null>(data.value);

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
			goto("/");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete");
		}
	}
</script>

{#if value}
	<div class="max-w-3xl">
		<h2 class="text-xl font-bold mb-6">
			{value.title || value._id.name} <span class="text-gray-400 font-normal">({value._id.lang})</span>
		</h2>
		<PageEdit mode="edit" bind:value onsave={save} ondelete={remove} />
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}