<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { trim } from "$lib/actions.ts";
	import { filesize, gameEmoji, timeAgo } from "$lib/utils.ts";
	import { tokens } from "$lib/auth.svelte.ts";
	import type { GameInfoFront } from "@bgs/models";
	import MarkdownEditor from "$components/MarkdownEditor.svelte";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let refreshing = $state(false);
	let announcement = $state({ title: "", content: "" });
	let gameId = $state("");
	let batchGameIds = $state("");

	// Initialise the editable announcement from the loaded serverInfo.
	$effect(() => {
		if (data.serverInfo?.announcement) {
			announcement.title = data.serverInfo.announcement.title ?? "";
			announcement.content = data.serverInfo.announcement.content ?? "";
		}
	});

	const serverInfo = $derived(data.serverInfo);
	const healthStatus = $derived(data.healthStatus);

	const gameStatuses = [
		{ key: "open", label: "Open", color: "text-blue-600 dark:text-blue-400" },
		{ key: "active", label: "Active", color: "text-amber-600 dark:text-amber-400" },
		{ key: "ended", label: "Ended", color: "text-gray-500 dark:text-gray-400" },
	] as const;

	// Map boardgame id → emoji, built from the sidebar's GameInfo labels.
	const gameEmojiByName = $derived(
		Object.fromEntries((page.data.games as GameInfoFront[]).map((g) => [g._id.game, gameEmoji(g.label)]))
	);

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	// gameId is trimmed on paste/blur by the use:trim action; the game page has the full tooling.
	function loadGame() {
		if (!gameId) return;
		goto(`/game/${encodeURIComponent(gameId)}`);
	}

	async function batchReplay() {
		const ids = batchGameIds
			.split("\n")
			.map((x) => x.trim())
			.filter(Boolean);
		if (ids.length === 0) {
			toast.error("Enter game IDs separated by newlines");
			return;
		}
		try {
			toast.info("Batch replay started");
			const info = await api.post<{ success: number }>("/gameplay/batch/replay", { gameIds: ids });
			toast.success(`Games replayed: ${info.success}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Batch replay failed");
		}
	}

	async function loadReplays() {
		try {
			toast.info("Loading replays");
			await api.post("/admin/load-games", { path: "/root/replay" });
			toast.success("Replays loaded");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to load replays");
		}
	}

	async function saveAnnouncement() {
		try {
			await api.post("/admin/announcement", { announcement });
			toast.success("Announcement updated");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to update");
		}
	}

	function backupUrl(): string {
		const token = tokens.getAccess("all")?.code ?? "";
		return `/api/admin/backup/games?token=${encodeURIComponent(token)}`;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-bold">Dashboard</h2>
		<button
			onclick={refresh}
			disabled={refreshing}
			class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
		>
			{refreshing ? "Refreshing…" : "Refresh"}
		</button>
	</div>

	<!-- Health indicator row -->
	{#if healthStatus}
		{@const healthConfig = {
			ok: { dot: "bg-green-500", text: "text-green-600 dark:text-green-400", label: "All healthy" },
			warn: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", label: "Some errors" },
			error: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", label: "High error rate" },
			down: { dot: "bg-gray-400", text: "text-gray-500 dark:text-gray-400", label: "Loki unavailable" },
		}[healthStatus.level]}
		<a
			href="/health"
			class="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
		>
			<span class="inline-block w-2.5 h-2.5 rounded-full {healthConfig.dot}"></span>
			<span class="text-sm font-medium {healthConfig.text}">{healthConfig.label}</span>
			{#if healthStatus.total > 0}
				<span class="text-xs text-gray-400">
					{healthStatus.errors.toLocaleString()} errors / {healthStatus.total.toLocaleString()} requests (1h)
				</span>
			{/if}
			<span class="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">View details →</span>
		</a>
	{/if}

	<!-- Metrics row -->
	{#if serverInfo}
		{@const totalGames = Object.values(serverInfo.games).reduce<number>((a, b) => a + (b ?? 0), 0)}
		{@const queueEntries = Object.entries(serverInfo.queue ?? {}).sort((a, b) => b[1] - a[1])}
		{@const totalQueue = queueEntries.reduce((a, [, n]) => a + n, 0)}
		<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Users</div>
				<div class="text-2xl font-bold mt-1">{serverInfo.nbUsers.toLocaleString()}</div>
				<div class="flex items-center gap-1.5 mt-1.5 text-xs">
					<span class="inline-block w-2 h-2 rounded-full {serverInfo.onlineUsers > 0 ? 'bg-green-500' : 'bg-gray-400'}"
					></span>
					<span class="text-gray-500 dark:text-gray-400">
						{serverInfo.onlineUsers} online
						{#if serverInfo.connectedUsers > serverInfo.onlineUsers}
							· {serverInfo.connectedUsers} connected
						{/if}
					</span>
				</div>
				{#if serverInfo.nbAdmins}
					<a href="/users" class="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block">
						{serverInfo.nbAdmins} admin{serverInfo.nbAdmins > 1 ? "s" : ""}
					</a>
				{/if}
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Games</div>
				<div class="text-2xl font-bold mt-1">{totalGames.toLocaleString()}</div>
				<div class="flex gap-3 mt-1.5 text-xs">
					{#each gameStatuses as s}
						<span class={s.color}>
							{serverInfo.games[s.key] ?? 0}
							{s.label.toLowerCase()}
						</span>
					{/each}
				</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Queue</div>
				<div class="text-2xl font-bold mt-1">{totalQueue.toLocaleString()}</div>
				{#if queueEntries.length}
					<div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
						{#each queueEntries as [kind, count]}
							<span>{count} {kind}</span>
						{/each}
					</div>
				{:else}
					<div class="text-xs text-gray-400 mt-1">empty</div>
				{/if}
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Disk Free</div>
				<div class="text-2xl font-bold mt-1">{filesize(serverInfo.disk.free)}</div>
				<div class="text-xs text-gray-400 mt-1">of {filesize(serverInfo.disk.size)}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Cron</div>
				<div class="text-2xl font-bold mt-1 flex items-center gap-2">
					<span class="inline-block w-2.5 h-2.5 rounded-full {serverInfo.cron ? 'bg-green-500' : 'bg-gray-400'}"></span>
					{serverInfo.cron ? "Active" : "Inactive"}
				</div>
			</div>
		</div>
	{/if}

	<!-- Activity row -->
	{#if serverInfo}
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
				<h3 class="text-sm font-semibold mb-3">Recent users</h3>
				{#if serverInfo.recentUsers?.length}
					<ul class="space-y-2">
						{#each serverInfo.recentUsers as u}
							<li class="flex items-center justify-between text-sm">
								<a
									href={`/user/${u.account.username}`}
									class="text-blue-600 dark:text-blue-400 hover:underline font-medium"
								>
									{u.account.username}
								</a>
								<span class="text-xs text-gray-400">{timeAgo(u.createdAt)}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-gray-400">No users</p>
				{/if}
			</div>

			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
				<h3 class="text-sm font-semibold mb-3">Recent games</h3>
				{#if serverInfo.recentGames?.length}
					<ul class="space-y-2">
						{#each serverInfo.recentGames as g}
							<li class="flex items-center justify-between gap-2 text-sm">
								<span class="flex items-center gap-1.5 min-w-0">
									<a
										href={`/game/${g._id}`}
										class="text-blue-600 dark:text-blue-400 hover:underline font-medium truncate"
									>
										<span class="mr-1">{gameEmojiByName[g.game.name] ?? ""}</span>
										{g._id}
									</a>
									<span class="text-xs flex-shrink-0" title="View on site">
										<WebLink path={`/game/${g._id}`}>↗</WebLink>
									</span>
								</span>
								<span class="text-xs text-gray-400 flex-shrink-0">{timeAgo(g.lastMove)}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-gray-400">No games</p>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Tools -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		<!-- Server Info + Announcement -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
			<h3 class="text-sm font-semibold">Announcement</h3>
			<div class="space-y-2">
				<label class="block text-xs font-medium text-gray-500">Title</label>
				<input
					bind:value={announcement.title}
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
				<MarkdownEditor bind:value={announcement.content} label="Content (Markdown)" rows={5} />
				<button
					onclick={saveAnnouncement}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
				>
					Update announcement
				</button>
			</div>
		</div>

		<!-- Backups -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Backups</h3>
			<a
				href={backupUrl()}
				target="_blank"
				rel="noopener"
				class="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 font-medium underline"
			>
				Download games backup
			</a>
		</div>

		<!-- Game Management -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Game Management</h3>
			<div>
				<label class="block text-xs font-medium text-gray-500 mb-1">Game ID</label>
				<input
					bind:value={gameId}
					use:trim
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					onkeydown={(e) => e.key === "Enter" && loadGame()}
				/>
			</div>
			<div>
				<button
					onclick={loadGame}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">Open</button
				>
			</div>
		</div>

		<!-- Mass Game Management -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Mass Game Management</h3>
			<div>
				<label class="block text-xs font-medium text-gray-500 mb-1">Game IDs (one per line)</label>
				<textarea
					bind:value={batchGameIds}
					rows="4"
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					placeholder="Paste game IDs separated by newlines"
				></textarea>
			</div>
			<div class="flex gap-2">
				<button
					onclick={batchReplay}
					class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium"
					>Mass replay</button
				>
				<button
					onclick={loadReplays}
					class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-sm font-medium">Load replays</button
				>
			</div>
		</div>
	</div>
</div>
