<script lang="ts">
	import { page } from "$app/state";
	import { goto } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadGames } from "$lib/stores.svelte.ts";
	import GameEdit, { type GameInfoData } from "$components/GameEdit.svelte";
	import type { GameInfoFront } from "@bgs/models";

	let value: GameInfoData | null = $state(null);

	const gameId = $derived(page.params.game);
	const version = $derived(Number(page.params.version));

	$effect(() => {
		if (gameId && version) load(gameId, version);
	});

	async function load(game: string, ver: number) {
		try {
			value = await api.get<GameInfoFront>(`/admin/gameinfo/${game}/${ver}`);
		} catch {
			toast.error("Game not found");
		}
	}

	async function save(data: GameInfoData) {
		try {
			await api.put(`/admin/gameinfo/${gameId}/${version}`, data);
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
			const dup = { ...value, _id: { game: gameId!, version: newVersion } };
			await api.post(`/admin/gameinfo/${gameId}/${newVersion}`, dup);
			toast.success(`Duplicated as v${newVersion}`);
			await loadGames();
			goto(`/game/${gameId}/${newVersion}`);
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
			goto("/");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete");
		}
	}
</script>

{#if value}
	<div>
		<h2 class="text-xl font-bold mb-6">{value.label} <span class="text-gray-400 font-normal">v{version}</span></h2>
		<GameEdit mode="edit" bind:value onsave={save} onduplicate={duplicate} ondelete={remove} />
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
