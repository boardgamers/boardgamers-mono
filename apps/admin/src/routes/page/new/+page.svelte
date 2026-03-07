<script lang="ts">
	import { goto } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadPages } from "$lib/stores.svelte.ts";
	import PageEdit from "$components/PageEdit.svelte";

	let value = $state({
		_id: { name: "", lang: "en" },
		title: "",
		content: "",
	});

	async function save(data: typeof value) {
		if (!data._id.name) {
			toast.error("Page name is required");
			return;
		}
		try {
			await api.post("/admin/page", data);
			toast.success("Page created");
			await loadPages();
			goto(`/page/${data._id.name}/${data._id.lang}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to create");
		}
	}
</script>

<div class="max-w-3xl">
	<h2 class="text-xl font-bold mb-6">New Page</h2>
	<PageEdit mode="new" bind:value onsave={save} />
</div>
