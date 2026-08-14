<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { gameLabelParts, timeAgo } from "$lib/utils.ts";
	import WebLink from "$components/WebLink.svelte";
	import type { GameInfoFront } from "@bgs/models";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	// Deleted locally after a successful DELETE; otherwise tracks the loaded data.
	let deleted = $state(false);
	let expandedError = $state<string | null>(null);
	let replayTo = $state(0);
	let editJson = $state("");
	let showJsonEditor = $state(false);

	const info = $derived(deleted ? null : data.info);

	const game = $derived(info?.game);
	const gameLabel = $derived(
		gameLabelParts((page.data.games as GameInfoFront[]).find((g) => g._id.game === game?.game.name)?.label).name ||
			game?.game.name
	);
	const statusColor = $derived(
		game?.status === "active"
			? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
			: game?.status === "ended"
				? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
				: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
	);

	function playerName(playerId: string): string {
		return info?.usernames[playerId] ?? playerId;
	}

	function formatDate(iso?: string): string {
		return iso ? new Date(iso).toLocaleString() : "—";
	}

	async function deleteGame() {
		if (!game || !confirm(`Delete game ${game._id}?`)) return;
		try {
			await api.del(`/game/${encodeURIComponent(game._id)}`);
			toast.success("Game deleted");
			deleted = true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete");
		}
	}

	async function cancelGame() {
		if (!game || !confirm(`Cancel game ${game._id}?`)) return;
		try {
			await api.post(`/admin/games/${encodeURIComponent(game._id)}/cancel`);
			toast.success("Game cancelled");
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to cancel");
		}
	}

	async function replayGame() {
		if (!game) return;
		try {
			await api.post(`/gameplay/${encodeURIComponent(game._id)}/replay`, { to: replayTo });
			toast.success("Replay started");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Replay failed");
		}
	}

	async function editGameData() {
		if (!game) return;
		if (!editJson.trim()) {
			toast.error("Body is empty");
			return;
		}
		try {
			const parsed = JSON.parse(editJson);
			await api.post(`/gameplay/${encodeURIComponent(game._id)}/edit-data`, { json: parsed });
			toast.success("Game data updated. If the current player changed, don't forget to replay it.");
			showJsonEditor = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Invalid JSON or update failed");
		}
	}
</script>

{#if info && game}
	<div class="space-y-6">
		<div class="flex items-center gap-3 flex-wrap">
			<h2 class="text-xl font-bold font-mono">{game._id}</h2>
			<span class="px-2 py-0.5 text-xs font-medium rounded-full {statusColor}">{game.status}</span>
			{#if game.cancelled}
				<span
					class="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
					>cancelled</span
				>
			{/if}
			<span class="text-sm text-gray-500 dark:text-gray-400">{gameLabel}</span>
			<div class="ml-auto flex items-center gap-4 text-sm">
				<WebLink path={`/game/${game._id}`} />
				<WebLink path={`/boardgame/${game.game.name}`}>Boardgame page ↗</WebLink>
			</div>
		</div>

		<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Version</div>
				<div class="text-sm font-medium mt-1">
					v{game.game.version}{game.game.expansions.length ? ` +${game.game.expansions.length} exp.` : ""}
				</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Players</div>
				<div class="text-sm font-medium mt-1">{game.players.length} / {game.options.setup.nbPlayers}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Created</div>
				<div class="text-sm font-medium mt-1" title={formatDate(game.createdAt)}>{timeAgo(game.createdAt)}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Last Move</div>
				<div class="text-sm font-medium mt-1" title={formatDate(game.lastMove)}>{timeAgo(game.lastMove)}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Seed</div>
				<div class="text-sm font-medium mt-1 font-mono truncate">{game.options.setup.seed || "—"}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Creator</div>
				<div class="text-sm font-medium mt-1 truncate">
					<a
						href={resolve("/user/[username]", { username: info.usernames[game.creator] ?? "" })}
						class="text-blue-600 dark:text-blue-400 hover:underline"
					>
						{playerName(game.creator)}
					</a>
				</div>
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
			<!-- Players -->
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
				<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
					<h3 class="text-sm font-semibold">Players</h3>
				</div>
				<div class="divide-y divide-gray-100 dark:divide-gray-800">
					{#each game.players as player (player._id)}
						<div class="px-5 py-2.5 flex items-center gap-3 text-sm">
							{#if game.currentPlayers?.some((p) => String(p._id) === player._id)}
								<span class="inline-block w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" title="Current player"
								></span>
							{/if}
							<a
								href={resolve("/user/[username]", { username: playerName(player._id) })}
								class="text-blue-600 dark:text-blue-400 hover:underline font-medium truncate"
							>
								{playerName(player._id)}
							</a>
							{#if player.faction}
								<span class="text-xs text-gray-500 truncate">{player.faction}</span>
							{/if}
							{#if player.pending}
								<span
									class="px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 flex-shrink-0"
									>pending</span
								>
							{/if}
							{#if player.dropped || player.quit}
								<span
									class="px-1.5 py-0.5 text-[10px] font-medium rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 flex-shrink-0"
									>{player.dropped ? "dropped" : "quit"}</span
								>
							{/if}
							<span class="ml-auto text-xs text-gray-400 flex-shrink-0">
								{game.status === "ended" && player.ranking ? `#${player.ranking} · ` : ""}{player.score} pts
							</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Options -->
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
				<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
					<h3 class="text-sm font-semibold">Options</h3>
				</div>
				<pre class="px-5 py-3 text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto">{JSON.stringify(
						{ ...game.options, ...(game.game.options ? { gameOptions: game.game.options } : {}) },
						null,
						2
					)}</pre>
			</div>
		</div>

		<!-- Chat -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
			<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
				<h3 class="text-sm font-semibold">Chat ({info.chat.length})</h3>
			</div>
			{#if info.chat.length > 0}
				<div class="divide-y divide-gray-100 dark:divide-gray-800 max-h-80 overflow-y-auto">
					{#each info.chat as msg (msg._id)}
						<div class="px-5 py-2 text-sm">
							<span class="font-medium {msg.type === 'system' ? 'text-gray-400 italic' : ''}"
								>{msg.author?.name ?? "system"}</span
							>
							<span class="text-gray-600 dark:text-gray-400">{msg.data.text}</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="px-5 py-4 text-sm text-gray-500">No messages.</p>
			{/if}
		</div>

		<!-- API Errors -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
			<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
				<h3 class="text-sm font-semibold">API Errors ({info.errors.length})</h3>
			</div>
			{#if info.errors.length > 0}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<tbody>
							{#each info.errors as err (err._id)}
								<tr
									class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
									onclick={() => (expandedError = expandedError === String(err._id) ? null : String(err._id))}
								>
									<td class="px-4 py-2 text-red-600 dark:text-red-400">{err.error.name}</td>
									<td class="px-4 py-2 font-mono text-xs">{err.request.method}</td>
									<td class="px-4 py-2 font-mono text-xs truncate max-w-[300px]">{err.request.url}</td>
									<td class="px-4 py-2 text-xs text-gray-400 text-right">{timeAgo(err.createdAt)}</td>
								</tr>
								{#if expandedError === String(err._id)}
									<tr>
										<td colspan="4" class="px-4 py-3 bg-gray-50 dark:bg-gray-950">
											<pre
												class="text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto">{JSON.stringify(
													err,
													null,
													2
												).replaceAll("\\n", "\n")}</pre>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="px-5 py-4 text-sm text-gray-500">No API errors involving this game.</p>
			{/if}
		</div>

		<!-- Processing logs -->
		{#if info.logs.length > 0}
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
				<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
					<h3 class="text-sm font-semibold">Logs ({info.logs.length})</h3>
				</div>
				<div class="divide-y divide-gray-100 dark:divide-gray-800">
					{#each info.logs as log (log.kind + ":" + (log.createdAt ?? "") + ":" + (log.data.player ?? ""))}
						<div class="px-5 py-2 flex items-center gap-3 text-sm">
							<span class="font-mono text-xs">{log.kind}</span>
							{#if log.data.player}
								<span class="text-xs text-gray-500">{playerName(String(log.data.player))}</span>
							{/if}
							<span class="ml-auto text-xs text-gray-400">{formatDate(log.createdAt)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Game Management -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Game Management</h3>
			<div>
				<label class="block text-xs font-medium text-gray-500 mb-1" for="replay-to">Replay to move #</label>
				<input
					id="replay-to"
					type="number"
					bind:value={replayTo}
					class="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>
			{#if showJsonEditor}
				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1" for="edit-json">JSON</label>
					<textarea
						id="edit-json"
						bind:value={editJson}
						rows="10"
						class="w-full font-mono text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 focus:outline-none focus:ring-2 focus:ring-blue-500"
					></textarea>
				</div>
			{/if}
			<div class="flex flex-wrap gap-2">
				<button
					onclick={replayGame}
					class="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium">Replay</button
				>
				<button
					onclick={() => (showJsonEditor = !showJsonEditor)}
					class="px-3 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg text-sm font-medium"
					>{showJsonEditor ? "Hide JSON" : "Edit JSON"}</button
				>
				{#if showJsonEditor}
					<button
						onclick={editGameData}
						class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">Save JSON</button
					>
				{/if}
				{#if game.status === "active"}
					<button
						onclick={cancelGame}
						class="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium"
						>Cancel</button
					>
				{/if}
				<button
					onclick={deleteGame}
					class="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium ml-auto">Delete</button
				>
			</div>
		</div>
	</div>
{:else}
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
		<h2 class="text-lg font-semibold mb-2">Game not found</h2>
		<p class="text-sm text-gray-500 dark:text-gray-400">
			No game with id <span class="font-mono">{page.params.gameId}</span> — it may have been deleted.
		</p>
	</div>
{/if}
