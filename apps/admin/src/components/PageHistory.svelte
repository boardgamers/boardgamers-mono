<script lang="ts">
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";

	interface HistoryEntry {
		_id: string;
		page: { name: string; lang: string };
		title: string;
		editedBy: string;
		editedByUsername: string | null;
		createdAt: string;
	}

	interface Props {
		name: string;
		lang: string;
		// Ask for confirmation, then load the archived title+content into the editor.
		onrestore: (entry: { title: string; content: string }) => void;
	}

	let { name, lang, onrestore }: Props = $props();

	let versions = $state<HistoryEntry[] | null>(null);
	let expanded = $state(false);
	let viewing = $state<(HistoryEntry & { content: string }) | null>(null);

	async function loadVersions() {
		try {
			versions = await api.get<HistoryEntry[]>(`/admin/page/${name}/${lang}/history`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to load history");
			versions = [];
		}
	}

	async function toggle() {
		expanded = !expanded;
		if (expanded && versions === null) {
			await loadVersions();
		}
	}

	async function view(entry: HistoryEntry) {
		try {
			viewing = await api.get<HistoryEntry & { content: string }>(`/admin/page/${name}/${lang}/history/${entry._id}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to load version");
		}
	}

	function restore() {
		if (!viewing) return;
		const entry = viewing;
		if (
			!confirm(`Restore the version from ${formatDate(entry.createdAt)}? The current content is kept in the history.`)
		)
			return;
		onrestore({ title: entry.title, content: entry.content });
		viewing = null;
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString();
	}

	function editorOf(entry: HistoryEntry) {
		return entry.editedByUsername ?? "unknown";
	}
</script>

<div class="mt-10 border-t border-gray-200 dark:border-gray-700 pt-6">
	<button type="button" onclick={toggle} class="flex items-center gap-2 text-lg font-semibold">
		<span class="inline-block transition-transform {expanded ? 'rotate-90' : ''}">▸</span>
		History{#if expanded && versions}&nbsp;<span class="text-sm font-normal text-gray-400"
				>({versions.length} version{versions.length === 1 ? "" : "s"})</span
			>{/if}
	</button>

	{#if expanded}
		{#if versions === null}
			<div class="mt-4 text-sm text-gray-400">Loading…</div>
		{:else if versions.length === 0}
			<div class="mt-4 text-sm text-gray-400">No previous versions.</div>
		{:else}
			<ul
				class="mt-4 divide-y divide-gray-200 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg"
			>
				{#each versions as entry (entry._id)}
					<li class="flex items-center gap-3 px-4 py-2.5 text-sm">
						<span class="text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(entry.createdAt)}</span>
						<span class="font-medium truncate">{editorOf(entry)}</span>
						<span class="text-gray-400 truncate hidden sm:inline">“{entry.title}”</span>
						<span class="ml-auto flex gap-2 shrink-0">
							<button
								type="button"
								onclick={() => view(entry)}
								class="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
							>
								View
							</button>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

{#if viewing}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			aria-label="Close"
			class="absolute inset-0 bg-black/50 cursor-default"
			onclick={() => (viewing = null)}
		></button>
		<div
			class="relative max-w-3xl w-full max-h-[85vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl p-6"
		>
			<h3 class="text-lg font-semibold">Version from {formatDate(viewing.createdAt)}</h3>
			<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
				Edited by {editorOf(viewing)} · Title: “{viewing.title}”
			</p>
			<pre
				class="mt-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-700 text-sm font-mono whitespace-pre-wrap break-words">{viewing.content}</pre>
			<div class="flex gap-2 mt-5">
				<button
					type="button"
					onclick={restore}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
				>
					Restore this version
				</button>
				<button
					type="button"
					onclick={() => (viewing = null)}
					class="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}
