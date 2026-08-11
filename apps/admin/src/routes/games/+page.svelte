<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { trim } from "$lib/actions.ts";
	import { gameEmoji, timeAgo } from "$lib/utils.ts";
	import type { GameInfoFront } from "@bgs/models";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	let refreshing = $state(false);
	let gameId = $state("");
	let batchGameIds = $state("");

	const gameStatuses = [
		{ key: "open", label: "Open", color: "text-blue-600 dark:text-blue-400" },
		{ key: "active", label: "Active", color: "text-amber-600 dark:text-amber-400" },
		{ key: "ended", label: "Ended", color: "text-gray-500 dark:text-gray-400" },
	] as const;

	const totalGames = $derived(Object.values(data.gameCounts).reduce<number>((a, b) => a + (b ?? 0), 0));

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
		goto(resolve("/game/[gameId]", { gameId }));
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
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-bold">Games</h2>
		<button
			onclick={refresh}
			disabled={refreshing}
			class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
		>
			{refreshing ? "Refreshing…" : "Refresh"}
		</button>
	</div>

	<!-- Metrics row -->
	<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
			<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Games</div>
			<div class="text-2xl font-bold mt-1">{totalGames.toLocaleString()}</div>
			<div class="flex gap-3 mt-1.5 text-xs">
				{#each gameStatuses as s (s.key)}
					<span class={s.color}>
						{data.gameCounts[s.key] ?? 0}
						{s.label.toLowerCase()}
					</span>
				{/each}
			</div>
		</div>
		<a
			href={resolve("/game/hangs")}
			class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
		>
			<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Engine hangs</div>
			<div class="text-2xl font-bold mt-1 {data.hangsTotal > 0 ? 'text-red-600 dark:text-red-400' : ''}">
				{data.hangsTotal.toLocaleString()}
			</div>
			<div class="text-xs text-gray-400 mt-1.5">timeouts recorded · view list →</div>
		</a>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		<!-- Game Management -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Game Management</h3>
			<div>
				<label class="block text-xs font-medium text-gray-500 mb-1" for="game-id">Game ID</label>
				<input
					id="game-id"
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
				<label class="block text-xs font-medium text-gray-500 mb-1" for="batch-game-ids">Game IDs (one per line)</label>
				<textarea
					id="batch-game-ids"
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

		<!-- Hangs -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-2">
			<h3 class="text-sm font-semibold">Engine hangs / timeouts</h3>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{data.hangsTotal.toLocaleString()} engine timeout{data.hangsTotal === 1 ? "" : "s"} recorded — runaway game engines
				terminated after exceeding their time budget.
			</p>
			<a href={resolve("/game/hangs")} class="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium">
				View hangs →
			</a>
		</div>

		<!-- Backups -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Backups</h3>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- /api file-download endpoint, not an app route -->
			<a
				href="/api/admin/backup/games"
				target="_blank"
				rel="noopener"
				class="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 font-medium underline"
				>Download games backup</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</div>

	<!-- Recent games -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
		<h3 class="text-sm font-semibold mb-3">Recent games</h3>
		{#if data.recentGames.length}
			<ul class="space-y-2">
				{#each data.recentGames as g (g._id)}
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
