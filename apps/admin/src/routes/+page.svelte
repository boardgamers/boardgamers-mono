<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { filesize, gameEmoji, timeAgo } from "$lib/utils.ts";
	import type { GameInfoFront } from "@bgs/models";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let refreshing = $state(false);

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
			href={resolve("/health")}
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
					<a
						href={resolve("/users")}
						class="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
					>
						{serverInfo.nbAdmins} admin{serverInfo.nbAdmins > 1 ? "s" : ""}
					</a>
				{/if}
			</div>
			<a
				href={resolve("/games")}
				class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
			>
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Games</div>
				<div class="text-2xl font-bold mt-1">{totalGames.toLocaleString()}</div>
				<div class="flex gap-3 mt-1.5 text-xs">
					{#each gameStatuses as s (s.key)}
						<span class={s.color}>
							{serverInfo.games[s.key] ?? 0}
							{s.label.toLowerCase()}
						</span>
					{/each}
				</div>
			</a>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Queue</div>
				<div class="text-2xl font-bold mt-1">{totalQueue.toLocaleString()}</div>
				{#if queueEntries.length}
					<div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-500 dark:text-gray-400">
						{#each queueEntries as [kind, count] (kind)}
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
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Forum</div>
				<div class="text-2xl font-bold mt-1 flex items-center gap-2">
					<span class="inline-block w-2.5 h-2.5 rounded-full {serverInfo.forum.ok ? 'bg-green-500' : 'bg-gray-400'}"
					></span>
					{serverInfo.forum.ok ? "Up" : "Down"}
					{#if serverInfo.forum.status}
						<span class="text-xs font-normal text-gray-400">({serverInfo.forum.status})</span>
					{/if}
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
						{#each serverInfo.recentUsers as u (u._id)}
							<li class="flex items-center justify-between text-sm">
								<a
									href={resolve("/user/[username]", { username: u.account.username })}
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
						{#each serverInfo.recentGames as g (g._id)}
							<li class="flex items-center justify-between gap-2 text-sm">
								<span class="flex items-center gap-1.5 min-w-0">
									<a
										href={resolve("/game/[gameId]", { gameId: g._id })}
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
		<!-- Announcement -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
			<h3 class="text-sm font-semibold">Announcement</h3>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				The homepage "Recent changes" box now shows the latest published changelog entries. Manage them on the
				<a href={resolve("/changelog")} class="text-blue-600 dark:text-blue-400 hover:underline">Changelog</a> page.
			</p>
		</div>
	</div>
</div>
