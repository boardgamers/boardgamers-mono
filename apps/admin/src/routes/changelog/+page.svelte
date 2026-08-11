<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo } from "$lib/utils.ts";
	import MarkdownEditor from "$components/MarkdownEditor.svelte";
	import WebLink from "$components/WebLink.svelte";
	import type { ChangelogFront } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// New-entry form state. A new entry sorts above the older ones by createdAt.
	let content = $state("");
	let details = $state("");
	let github = $state("");
	let published = $state(true);
	let saving = $state(false);

	// id of the entry being edited inline, plus a copy of its fields.
	let editingId = $state<string | null>(null);
	let editContent = $state("");
	let editDetails = $state("");
	let editGithub = $state("");
	let editPublished = $state(false);

	function startEdit(entry: ChangelogFront) {
		editingId = entry._id;
		editContent = entry.content;
		editDetails = entry.details ?? "";
		editGithub = entry.github ?? "";
		editPublished = entry.published;
	}

	async function createEntry() {
		saving = true;
		try {
			await api.post("/admin/changelog", {
				content: content.trim(),
				details: details.trim() || undefined,
				github: github.trim() || undefined,
				published,
			});
			content = "";
			details = "";
			github = "";
			published = true;
			toast.success("Changelog entry added");
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to create entry");
		} finally {
			saving = false;
		}
	}

	async function saveEdit() {
		if (!editingId) return;
		saving = true;
		try {
			// Empty strings are sent as-is: the API clears the optional field.
			await api.put(`/admin/changelog/${editingId}`, {
				content: editContent.trim(),
				details: editDetails.trim(),
				github: editGithub.trim(),
				published: editPublished,
			});
			editingId = null;
			toast.success("Entry updated");
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to update entry");
		} finally {
			saving = false;
		}
	}

	async function togglePublished(entry: ChangelogFront) {
		try {
			await api.put(`/admin/changelog/${entry._id}`, { published: !entry.published });
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to update entry");
		}
	}

	async function remove(entry: ChangelogFront) {
		if (!confirm(`Delete "${entry.content}"? This cannot be undone.`)) return;
		try {
			await api.del(`/admin/changelog/${entry._id}`);
			toast.success("Entry deleted");
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete entry");
		}
	}
</script>

<svelte:head>
	<title>Changelog — Admin</title>
</svelte:head>

<div class="space-y-6 max-w-4xl">
	<div>
		<h2 class="text-xl font-bold">Changelog</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
			Entries shown on the homepage's "Recent changes" box (latest 4) and on the
			<WebLink path="/changelog">public changelog page</WebLink>. An entry is a short one-liner (emoji + description);
			`details` and the GitHub link are optional and only shown on the changelog page. Drafts stay hidden until
			published.
		</p>
	</div>

	<!-- New entry -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
		<h3 class="text-sm font-semibold mb-4">New entry</h3>
		<form
			class="space-y-3"
			onsubmit={(e) => {
				e.preventDefault();
				createEntry();
			}}
		>
			<label class="block">
				<span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Change (short one-liner)</span>
				<input
					bind:value={content}
					required
					maxlength="500"
					placeholder="e.g. 🪐 Gaia Project: Ivits available"
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</label>
			<MarkdownEditor bind:value={details} label="Details (optional, Markdown — changelog page only)" rows={4} />
			<label class="block">
				<span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">GitHub link (optional)</span>
				<input
					bind:value={github}
					type="url"
					placeholder="https://github.com/boardgamers/boardgamers-mono/pull/…"
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</label>
			<div class="flex items-center justify-between">
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={published} class="rounded" />
					Published
				</label>
				<button
					type="submit"
					disabled={saving || !content.trim()}
					class="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
				>
					{saving ? "Saving…" : "Add entry"}
				</button>
			</div>
		</form>
	</div>

	<!-- Entries -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
			<h3 class="text-sm font-semibold">
				Entries
				<span class="text-gray-400 font-normal">({data.entries.length})</span>
			</h3>
		</div>
		{#if data.entries.length > 0}
			<ul class="divide-y divide-gray-100 dark:divide-gray-800/60">
				{#each data.entries as entry (entry._id)}
					<li class="px-5 py-3">
						{#if editingId === entry._id}
							<div class="space-y-3">
								<input
									bind:value={editContent}
									maxlength="500"
									class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								/>
								<MarkdownEditor
									bind:value={editDetails}
									label="Details (optional, Markdown — changelog page only)"
									rows={4}
								/>
								<input
									bind:value={editGithub}
									type="url"
									placeholder="https://github.com/boardgamers/boardgamers-mono/pull/…"
									class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
								/>
								<div class="flex items-center justify-between">
									<label class="flex items-center gap-2 text-sm">
										<input type="checkbox" bind:checked={editPublished} class="rounded" />
										Published
									</label>
									<div class="flex gap-2">
										<button
											onclick={() => (editingId = null)}
											class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
										>
											Cancel
										</button>
										<button
											onclick={saveEdit}
											disabled={saving || !editContent.trim()}
											class="px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
										>
											{saving ? "Saving…" : "Save"}
										</button>
									</div>
								</div>
							</div>
						{:else}
							<div class="flex items-center justify-between gap-3">
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="font-medium text-sm truncate">{entry.content}</span>
										{#if !entry.published}
											<span
												class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
											>
												draft
											</span>
										{/if}
										{#if entry.details}
											<span
												class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
											>
												details
											</span>
										{/if}
										{#if entry.github}
											<!-- eslint-disable svelte/no-navigation-without-resolve -- external URL from the entry (target=_blank), resolve() is for internal paths; the rule's report range spans the whole multi-line tag -->
											<a
												href={entry.github}
												target="_blank"
												rel="noopener noreferrer"
												class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:underline"
											>
												GitHub
											</a>
											<!-- eslint-enable svelte/no-navigation-without-resolve -->
										{/if}
									</div>
									<div class="text-xs text-gray-400 mt-0.5" title={entry.createdAt}>
										{timeAgo(entry.createdAt)}{entry.updatedAt ? ` · edited ${timeAgo(entry.updatedAt)}` : ""}
									</div>
								</div>
								<div class="flex gap-2 flex-shrink-0">
									<button
										onclick={() => togglePublished(entry)}
										class="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
									>
										{entry.published ? "Unpublish" : "Publish"}
									</button>
									<button
										onclick={() => startEdit(entry)}
										class="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
									>
										Edit
									</button>
									<button
										onclick={() => remove(entry)}
										class="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-700 dark:hover:text-red-300 text-gray-600 dark:text-gray-300"
									>
										Delete
									</button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="px-5 py-4 text-sm text-gray-500">No entries yet. Add one above — it will show up on the homepage.</p>
		{/if}
	</div>
</div>
