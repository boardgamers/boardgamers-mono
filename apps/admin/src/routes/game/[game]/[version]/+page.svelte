<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { untrack } from "svelte";
	import { api, ApiError } from "$lib/api.ts";
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

	// Preconditions are enforced server-side. Archiving the latest public version
	// is a hard 409 (toast only); ongoing games are a soft 409 the admin can
	// confirm-and-proceed past by retrying with { force: true }.
	async function toggleArchive() {
		const archived = !!value?.meta?.archived;
		const action = archived ? "unarchive" : "archive";
		if (!confirm(`${archived ? "Unarchive" : "Archive"} ${gameId} v${version}?`)) return;
		try {
			await api.post(`/admin/gameinfo/${gameId}/${version}/${action}`);
		} catch (err) {
			// ApiError only carries message+status — the structured `error`/
			// `count` fields of the ongoing-games 409 are recovered from the
			// server message.
			const ongoing = err instanceof ApiError && err.status === 409 && !archived
				? /(\d+) ongoing game/.exec(err.message)
				: null;
			if (ongoing) {
				if (!confirm(`There are still ${ongoing[1]} ongoing game(s) on this version. Archive anyway?`)) return;
				try {
					await api.post(`/admin/gameinfo/${gameId}/${version}/${action}`, { force: true });
				} catch (retryErr) {
					toast.error(retryErr instanceof Error ? retryErr.message : `Failed to ${action}`);
					return;
				}
			} else {
				toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
				return;
			}
		}
		toast.success(archived ? "Unarchived" : "Archived");
		await loadGames();
	}
</script>

{#if value}
	<div>
		<div class="flex items-center gap-4 mb-6">
			<h2 class="text-xl font-bold">{value.label} <span class="text-gray-400 font-normal">v{version}</span></h2>
			{#if value.meta?.archived}
				<span
					class="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
				>
					Archived
				</span>
			{/if}
			<button
				onclick={toggleArchive}
				class="px-3 py-1.5 text-sm rounded-lg font-medium {value.meta?.archived
					? 'bg-gray-600 hover:bg-gray-700 text-white'
					: 'bg-amber-600 hover:bg-amber-700 text-white'}"
			>
				{value.meta?.archived ? "Unarchive" : "Archive"}
			</button>
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
