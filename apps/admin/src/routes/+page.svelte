<script lang="ts">
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { filesize } from "$lib/utils.ts";
	import { auth } from "$lib/auth.svelte.ts";

	interface ServerInfo {
		disk: { free: number; size: number };
		nbUsers: number;
		announcement: { title: string; content: string };
		cron: boolean;
	}

	let serverInfo: ServerInfo | null = $state(null);
	let announcement = $state({ title: "", content: "" });
	let gameId = $state("");
	let gameData: unknown = $state(null);
	let gameLength: number | null = $state(null);
	let replayTo = $state(0);
	let editJson = $state("");
	let showJsonEditor = $state(false);
	let batchGameIds = $state("");

	$effect(() => {
		loadServerInfo();
	});

	async function loadServerInfo() {
		try {
			serverInfo = await api.get<ServerInfo>("/admin/serverinfo");
			if (serverInfo?.announcement) {
				announcement.title = serverInfo.announcement.title ?? "";
				announcement.content = serverInfo.announcement.content ?? "";
			}
		} catch {
			toast.error("Failed to load server info");
		}
	}

	async function loadGame() {
		if (!gameId.trim()) return;
		try {
			const [data, length] = await Promise.all([
				api.get(`/gameplay/${gameId}?admin=true`),
				api.get<number>(`/gameplay/${gameId}/length`),
			]);
			gameData = data;
			gameLength = length;
			replayTo = length;
			editJson = JSON.stringify((data as { data?: unknown })?.data ?? data, null, 2);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Game not found");
			gameData = null;
			gameLength = null;
		}
	}

	async function deleteGame() {
		if (!confirm(`Delete game ${gameId}?`)) return;
		try {
			await api.del(`/game/${gameId}`);
			toast.success("Game deleted");
			gameData = null;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete");
		}
	}

	async function replayGame() {
		try {
			await api.post(`/gameplay/${gameId}/replay`, { to: replayTo });
			toast.success("Replay started");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Replay failed");
		}
	}

	async function editGameData() {
		if (!editJson.trim()) {
			toast.error("Body is empty");
			return;
		}
		try {
			const parsed = JSON.parse(editJson);
			await api.post(`/gameplay/${gameId}/edit-data`, { json: parsed });
			toast.success("Game data updated. If the current player changed, don't forget to replay it.");
			showJsonEditor = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Invalid JSON or update failed");
		}
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
		const token = auth.accessTokens["all"]?.code ?? "";
		return `/api/admin/backup/games?token=${encodeURIComponent(token)}`;
	}
</script>

<div class="max-w-5xl space-y-6">
	<h2 class="text-xl font-bold">Dashboard</h2>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- Server Info + Announcement -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
			<h3 class="text-sm font-semibold">Server Info</h3>
			{#if serverInfo}
				<div class="grid grid-cols-3 gap-3 text-sm">
					<div>
						<div class="text-xs text-gray-500 dark:text-gray-400 uppercase">Users</div>
						<div class="text-lg font-bold">{serverInfo.nbUsers.toLocaleString()}</div>
					</div>
					<div>
						<div class="text-xs text-gray-500 dark:text-gray-400 uppercase">Disk Free</div>
						<div class="text-lg font-bold">{filesize(serverInfo.disk.free)}</div>
						<div class="text-xs text-gray-400">of {filesize(serverInfo.disk.size)}</div>
					</div>
					<div>
						<div class="text-xs text-gray-500 dark:text-gray-400 uppercase">Cron</div>
						<div class="text-lg font-bold">{serverInfo.cron ? "Active" : "Inactive"}</div>
					</div>
				</div>
			{/if}

			<hr class="border-gray-100 dark:border-gray-800" />

			<div class="space-y-2">
				<label class="block text-xs font-medium text-gray-500">Announcement Title</label>
				<input
					bind:value={announcement.title}
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
				<label class="block text-xs font-medium text-gray-500">Announcement Content</label>
				<textarea
					bind:value={announcement.content}
					rows="3"
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				></textarea>
				<button
					onclick={saveAnnouncement}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
				>
					Update announcement
				</button>
			</div>
		</div>

		<!-- Game Lookup -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Game Management</h3>
			<div>
				<label class="block text-xs font-medium text-gray-500 mb-1">Game ID</label>
				<input
					bind:value={gameId}
					class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					onkeydown={(e) => e.key === "Enter" && loadGame()}
				/>
			</div>

			{#if gameData}
				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1">Replay to move #</label>
					<input
						type="number"
						bind:value={replayTo}
						class="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
					<span class="text-xs text-gray-400 ml-2">of {gameLength}</span>
				</div>

				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1">JSON</label>
					<textarea
						bind:value={editJson}
						rows="10"
						class="w-full font-mono text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
					></textarea>
				</div>
			{/if}

			<div class="flex flex-wrap gap-2">
				{#if !gameData}
					<button
						onclick={loadGame}
						class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">Load</button
					>
				{:else}
					<button
						onclick={replayGame}
						class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium">Replay</button
					>
					<button
						onclick={editGameData}
						class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">Save JSON</button
					>
					<button
						onclick={deleteGame}
						class="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium ml-auto"
						>Delete</button
					>
				{/if}
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

		<!-- Backups -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Backups</h3>
			<a
				href={backupUrl()}
				target="_blank"
				rel="noopener"
				class="text-sm text-blue-600 hover:text-blue-500 font-medium underline"
			>
				Download games backup
			</a>
		</div>
	</div>
</div>
