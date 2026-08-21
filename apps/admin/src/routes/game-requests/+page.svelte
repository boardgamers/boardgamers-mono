<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { can } from "$lib/permissions.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo } from "$lib/utils.ts";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";
	import type { AdminGameRequest } from "./+page";

	let { data }: PageProps = $props();

	let deletingId = $state<string | null>(null);
	let mergingId = $state<string | null>(null);
	let mergeTargets = $state<Record<string, string>>({});

	const otherRequests = (id: string) => data.requests.filter((r) => r._id !== id);

	async function deleteRequest(request: AdminGameRequest) {
		if (!confirm(`Delete the request for "${request.label}"? Its ${request.likeCount} vote(s) are lost.`)) return;
		deletingId = request._id;
		try {
			await api.del(`/admin/feedback/game-requests/${encodeURIComponent(request._id)}`);
			toast.success(`Deleted the request for "${request.label}"`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete the request");
		} finally {
			deletingId = null;
		}
	}

	async function mergeRequest(request: AdminGameRequest) {
		const into = mergeTargets[request._id];
		if (!into) return;
		const targetRequest = data.requests.find((r) => r._id === into);
		const targetGame = data.games.find((g) => g._id === into);
		const target = targetRequest ?? targetGame;
		if (!target) return;
		if (
			!confirm(
				`Merge "${request.label}" into ${targetGame ? "the existing game" : "the request"} "${target.label}"? ` +
					`Its ${request.likeCount} vote(s) move over (one per user) and the request is deleted.`
			)
		)
			return;
		mergingId = request._id;
		try {
			await api.post(`/admin/feedback/game-requests/${encodeURIComponent(request._id)}/merge`, { into });
			toast.success(`Merged "${request.label}" into "${target.label}"`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to merge the request");
		} finally {
			mergingId = null;
		}
	}
</script>

<svelte:head>
	<title>Game requests — Admin</title>
</svelte:head>

<div class="space-y-6 max-w-5xl">
	<div>
		<h2 class="text-xl font-bold">Game requests</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
			Whole-game ("add game") requests voted on at the
			<WebLink path="/feedback">public feedback page</WebLink>. Delete spam/duplicates, or merge a duplicate into the
			canonical request — or into the existing game — to carry its votes over. Beta games with an implementation are
			managed from their boardgame page instead.
			{#if !can(data.me, "feedback")}
				<span class="block mt-1">
					You admin {data.me.games.length === 1 ? "one game" : `${data.me.games.length} games`} — only their requests are
					shown.
				</span>
			{/if}
		</p>
	</div>

	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
			<h3 class="text-sm font-semibold">
				Open requests
				<span class="text-gray-400 font-normal">({data.requests.length})</span>
			</h3>
		</div>
		{#if data.requests.length > 0}
			<ul class="divide-y divide-gray-100 dark:divide-gray-800/60">
				{#each data.requests as request (request._id)}
					<li class="px-5 py-4">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-medium text-sm">{request.label}</span>
									<span
										class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
										title={request._id}
									>
										{request._id}
									</span>
								</div>
								{#if request.description}
									<p class="text-sm text-gray-600 dark:text-gray-400 mt-1 whitespace-pre-line">{request.description}</p>
								{/if}
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400 mt-1.5">
									{#if request.requestedBy}
										<span>by {request.requestedBy}</span>
									{/if}
									<span title={request.createdAt}>{timeAgo(request.createdAt)}</span>
									<span>▲ {request.likeCount}</span>
									{#if request.forumTid}
										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external forum URL built from the stored topic id -->
										<a
											href="https://forum.boardgamers.space/topic/{request.forumTid}"
											target="_blank"
											rel="noopener noreferrer"
											class="text-blue-600 dark:text-blue-400 hover:underline"
										>
											Forum discussion ↗
										</a>
									{/if}
								</div>
							</div>
							<div class="flex-shrink-0 flex items-center gap-2">
								{#if data.requests.length > 1 || data.games.length > 0}
									<select
										bind:value={mergeTargets[request._id]}
										disabled={mergingId === request._id || deletingId === request._id}
										class="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
									>
										<option value="">Merge into…</option>
										{#if otherRequests(request._id).length > 0}
											<optgroup label="Requests">
												{#each otherRequests(request._id) as target (target._id)}
													<option value={target._id}>{target.label} (▲ {target.likeCount})</option>
												{/each}
											</optgroup>
										{/if}
										{#if data.games.length > 0}
											<optgroup label="Existing games">
												{#each data.games as game (game._id)}
													<option value={game._id}>{game.label}</option>
												{/each}
											</optgroup>
										{/if}
									</select>
									<button
										onclick={() => mergeRequest(request)}
										disabled={!mergeTargets[request._id] || mergingId === request._id || deletingId === request._id}
										class="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
									>
										Merge
									</button>
								{/if}
								<button
									onclick={() => deleteRequest(request)}
									disabled={deletingId === request._id || mergingId === request._id}
									class="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50"
								>
									Delete
								</button>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="px-5 py-4 text-sm text-gray-500">No open game requests.</p>
		{/if}
	</div>
</div>
