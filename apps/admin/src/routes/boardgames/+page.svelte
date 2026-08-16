<script lang="ts">
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import MarkdownEditor from "$components/MarkdownEditor.svelte";
	import type { GameMetadataDoc } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	type MetaData = Omit<GameMetadataDoc, "_id" | "createdAt" | "updatedAt" | "likeCount">;

	let selected = $state<string | null>(null);
	let loading = $state(false);
	let meta = $state<MetaData | null>(null);

	const inputClass =
		"w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
	const labelClass = "block text-xs font-medium mb-1 text-gray-500 dark:text-gray-400";

	async function edit(game: string) {
		selected = game;
		loading = true;
		meta = null;
		try {
			const doc = await api.get<GameMetadataDoc | null>(`/admin/gameinfo/${encodeURIComponent(game)}/meta`);
			if (doc) {
				// Server-managed fields must not round-trip into the PUT body.
				const { _id, createdAt, updatedAt, likeCount, ...editable } = doc;
				meta = editable;
			} else {
				meta = { label: game, players: [] };
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to load metadata");
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (!selected || !meta) return;
		try {
			meta.alias = meta.alias?.trim() || null;
			await api.put(`/admin/gameinfo/${encodeURIComponent(selected)}/meta`, meta);
			toast.success("Metadata saved");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save metadata");
		}
	}

	function addPlayer() {
		if (!meta) return;
		meta.players = [...meta.players, meta.players.length > 0 ? Math.max(...meta.players) + 1 : 2];
	}

	function removePlayer(i: number) {
		if (!meta) return;
		meta.players = meta.players.filter((_, j) => j !== i);
	}
</script>

<div class="space-y-6">
	<h2 class="text-xl font-bold">Boardgame metadata</h2>
	<p class="text-sm text-gray-500 dark:text-gray-400">
		Game-level fields (label, description, rules, player counts, ownership) are shared by every version and edited here.
		Expansions are version-scoped (a setup option that can differ per version) and edited on the version page.
	</p>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- List -->
		<div class="space-y-1">
			{#each data.games as g (g.game)}
				<button
					onclick={() => edit(g.game)}
					class="w-full text-left px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-sm {selected ===
					g.game
						? 'bg-gray-100 dark:bg-gray-800 font-semibold'
						: ''}"
				>
					{g.label} <span class="text-gray-400">({g.game})</span>
				</button>
			{/each}
		</div>

		<!-- Editor -->
		<div>
			{#if loading}
				<p class="text-sm text-gray-400">Loading…</p>
			{:else if meta}
				<div class="space-y-4">
					<div>
						<label for="meta-label" class={labelClass}>Label</label>
						<input id="meta-label" bind:value={meta.label} class={inputClass} />
					</div>
					<div>
						<label for="meta-alias" class={labelClass}>Alias</label>
						<input id="meta-alias" bind:value={meta.alias} class={inputClass} />
					</div>
					<MarkdownEditor bind:value={meta.description} label="Description (Markdown)" rows={4} />
					<MarkdownEditor bind:value={meta.rules} label="Rules (Markdown)" rows={8} />

					<div>
						<label for="meta-player-0" class={labelClass}>Players</label>
						<div class="flex flex-wrap gap-2 items-center">
							{#each meta.players as _, i (i)}
								<div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm">
									<input
										id={"meta-player-" + i}
										type="number"
										bind:value={meta.players[i]}
										class="w-12 bg-transparent text-center focus:outline-none"
									/>
									<button onclick={() => removePlayer(i)} class="text-red-500 hover:text-red-400 ml-1">&times;</button>
								</div>
							{/each}
							<button onclick={addPlayer} class="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-500 font-medium"
								>+ Add</button
							>
						</div>
					</div>

					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={meta.needOwnership} class="rounded" /> Requires ownership
					</label>

					<div>
						<button onclick={save} class="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
							Save
						</button>
					</div>
				</div>
			{:else}
				<p class="text-sm text-gray-400">Select a game to edit its metadata.</p>
			{/if}
		</div>
	</div>
</div>
