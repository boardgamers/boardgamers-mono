<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { can } from "$lib/permissions.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo } from "$lib/utils.ts";
	import WebLink from "$components/WebLink.svelte";
	import type { FeedbackKind, FeedbackStatus } from "@bgs/models";
	import type { PageProps } from "./$types";
	import type { AdminFeedbackRequest } from "./+page";

	let { data }: PageProps = $props();

	const KIND_LABELS: Record<FeedbackKind, string> = {
		site: "Site",
		game: "Game",
	};

	const STATUS_LABELS: Record<FeedbackStatus, string> = {
		open: "Open",
		planned: "Planned",
		done: "Done",
		declined: "Declined",
	};

	const STATUS_BADGE_CLASSES: Record<FeedbackStatus, string> = {
		open: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
		planned: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300",
		done: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
		declined: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
	};

	let kindFilter = $state<"" | FeedbackKind>("");
	let statusFilter = $state<"" | FeedbackStatus>("");
	let gameFilter = $state("");
	let updatingId = $state<string | null>(null);

	const gameLabelById = $derived(Object.fromEntries(data.games.map((g) => [g._id.game, g.label] as const)));

	const filtered = $derived(
		data.requests.filter(
			(r) =>
				(!kindFilter || r.kind === kindFilter) &&
				(!statusFilter || r.status === statusFilter) &&
				(!gameFilter || r.game === gameFilter)
		)
	);

	const counts = $derived.by(() => {
		const byStatus: Record<FeedbackStatus, number> = { open: 0, planned: 0, done: 0, declined: 0 };
		for (const r of data.requests) {
			byStatus[r.status]++;
		}
		return byStatus;
	});

	function gameLabel(request: AdminFeedbackRequest): string {
		return request.game ? (gameLabelById[request.game] ?? request.game) : "";
	}

	async function setStatus(request: AdminFeedbackRequest, status: FeedbackStatus) {
		if (status === request.status) return;
		updatingId = request._id!;
		try {
			await api.patch(`/feedback/${request._id}/status`, { status });
			toast.success(`"${request.title}" → ${STATUS_LABELS[status]}`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to update status");
		} finally {
			updatingId = null;
		}
	}
</script>

<svelte:head>
	<title>Feedback — Admin</title>
</svelte:head>

<div class="space-y-6 max-w-5xl">
	<div>
		<h2 class="text-xl font-bold">Feedback &amp; requests</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
			Site feature requests and per-game requests submitted on the
			<WebLink path="/feedback">public feedback page</WebLink>. Triage them here: mark what you plan to do, what
			shipped, and what you decline.
			{#if !can(data.me, "feedback")}
				<span class="block mt-1">
					You admin {data.me.games.length === 1 ? "one game" : `${data.me.games.length} games`} — only their requests are
					shown.
				</span>
			{/if}
		</p>
	</div>

	<!-- Filters -->
	<div
		class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-wrap items-end gap-4"
	>
		<label class="block">
			<span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Kind</span>
			<select
				bind:value={kindFilter}
				class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
			>
				<option value="">All kinds ({data.requests.length})</option>
				{#each Object.entries(KIND_LABELS) as [kind, label] (kind)}
					<option value={kind}>{label}</option>
				{/each}
			</select>
		</label>
		<label class="block">
			<span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Status</span>
			<select
				bind:value={statusFilter}
				class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
			>
				<option value="">All statuses</option>
				{#each Object.entries(STATUS_LABELS) as [status, label] (status)}
					<option value={status}>{label} ({counts[status as FeedbackStatus]})</option>
				{/each}
			</select>
		</label>
		<label class="block">
			<span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Game</span>
			<select
				bind:value={gameFilter}
				class="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
			>
				<option value="">All games</option>
				{#each data.games as g (g._id.game)}
					<option value={g._id.game}>{g.label}</option>
				{/each}
			</select>
		</label>
		{#if kindFilter || statusFilter || gameFilter}
			<button
				onclick={() => {
					kindFilter = "";
					statusFilter = "";
					gameFilter = "";
				}}
				class="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
			>
				Clear
			</button>
		{/if}
	</div>

	<!-- Requests -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
			<h3 class="text-sm font-semibold">
				Requests
				<span class="text-gray-400 font-normal">({filtered.length})</span>
			</h3>
		</div>
		{#if filtered.length > 0}
			<ul class="divide-y divide-gray-100 dark:divide-gray-800/60">
				{#each filtered as request (request._id)}
					<li class="px-5 py-4">
						<div class="flex items-start justify-between gap-4">
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-medium text-sm">{request.title}</span>
									<span class="px-2 py-0.5 text-xs font-medium rounded-full {STATUS_BADGE_CLASSES[request.status]}">
										{STATUS_LABELS[request.status]}
									</span>
									<span
										class="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
									>
										{KIND_LABELS[request.kind]}
									</span>
									{#if request.kind === "game" && request.game}
										<span
											class="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300"
											title={request.game}
										>
											{gameLabel(request)}
										</span>
									{/if}
								</div>
								{#if request.body}
									<p class="text-sm text-gray-600 dark:text-gray-400 mt-1 whitespace-pre-line">{request.body}</p>
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
							<label class="flex-shrink-0">
								<span class="sr-only">Status</span>
								<select
									value={request.status}
									disabled={updatingId === request._id}
									onchange={(e) => setStatus(request, e.currentTarget.value as FeedbackStatus)}
									class="px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
								>
									{#each Object.entries(STATUS_LABELS) as [status, label] (status)}
										<option value={status}>{label}</option>
									{/each}
								</select>
							</label>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="px-5 py-4 text-sm text-gray-500">
				{data.requests.length === 0 ? "No feedback requests yet." : "No requests match the current filters."}
			</p>
		{/if}
	</div>
</div>
