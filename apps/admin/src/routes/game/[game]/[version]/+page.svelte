<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { untrack } from "svelte";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadGames } from "$lib/stores.svelte.ts";
	import GameEdit, { type GameInfoData } from "$components/GameEdit.svelte";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const gameId = $derived(data.value?._id?.game ?? "");
	const version = $derived(data.value?._id?.version ?? 0);

	// Editable (bind:value into GameEdit); re-synced from load data by the $effect.
	// eslint-disable-next-line svelte/prefer-writable-derived -- GameEdit mutates `value` via bind:value; it is not purely derived from `data`.
	let value = $state<GameInfoData | null>(untrack(() => data.value));

	$effect(() => {
		value = data.value;
	});

	async function save(saveData: GameInfoData) {
		try {
			await api.put(`/admin/gameinfo/${gameId}/${version}`, saveData);
			toast.success("Game saved");
			await loadGames();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save");
		}
	}

	async function duplicate() {
		if (!value) return;
		const newVersion = version + 1;
		try {
			const dup = { ...value, _id: { game: gameId, version: newVersion } };
			await api.post(`/admin/gameinfo/${gameId}/${newVersion}`, dup);
			toast.success(`Duplicated as v${newVersion}`);
			await loadGames();
			goto(resolve("/game/[game]/[version]", { game: gameId, version: String(newVersion) }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to duplicate");
		}
	}

	async function remove() {
		if (!confirm(`Delete ${gameId} v${version}?`)) return;
		try {
			await api.del(`/admin/gameinfo/${gameId}/${version}`);
			toast.success("Deleted");
			await loadGames();
			goto(resolve("/"));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete");
		}
	}
</script>

{#if value}
	<div>
		<div class="flex items-center gap-4 mb-6">
			<h2 class="text-xl font-bold">{value.label} <span class="text-gray-400 font-normal">v{version}</span></h2>
			<div class="ml-auto text-sm">
				<WebLink path={`/boardgame/${gameId}`} />
			</div>
		</div>
		<GameEdit mode="edit" bind:value onsave={save} onduplicate={duplicate} ondelete={remove} />
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
