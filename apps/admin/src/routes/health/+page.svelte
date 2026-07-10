<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import type { HealthData } from "./+page.ts";

	let { data }: { data: { health: HealthData } } = $props();

	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	const health = $derived(data.health);
	const lokiAvailable = $derived(health.lokiAvailable);
	const statusCounts = $derived(health.statusCounts);
	const slowEndpoints = $derived(health.slowEndpoints);
	const errorEndpoints = $derived(health.errorEndpoints);
	const recentErrors = $derived(health.recentErrors);
	const dbErrors = $derived(health.dbErrors);

	function statusClass(status: string): string {
		const c = Number(status);
		if (c >= 500) return "bg-red-500";
		if (c >= 400) return "bg-amber-500";
		if (c >= 300) return "bg-blue-500";
		return "bg-green-500";
	}

	function formatTime(ts: number): string {
		// Loki returns nanosecond timestamps
		const ms = Math.floor(ts / 1_000_000);
		const d = new Date(ms);
		return d.toLocaleTimeString();
	}

	const totalRequests = $derived(statusCounts.reduce((a, b) => a + b.count, 0));
	const errorCount = $derived(statusCounts.filter((s) => Number(s.status) >= 400).reduce((a, b) => a + b.count, 0));
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-xl font-bold">Server Health</h2>
		</div>
		<button
			onclick={refresh}
			disabled={refreshing}
			class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
		>
			{refreshing ? "Refreshing…" : "Refresh"}
				</button>
			</div>

			{#if !lokiAvailable}
				<div
					class="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl"
				>
					<span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>
					<div class="text-sm">
						<span class="font-medium text-amber-700 dark:text-amber-400">Loki is unavailable.</span>
						<span class="text-amber-600 dark:text-amber-500/80"
							> Logging is not running, so no health metrics are available. Start the stack with
							<code class="font-mono text-xs">systemctl start bgs-loki</code> and refresh.</span
						>
					</div>
				</div>
			{:else}
				<!-- Summary cards -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Requests (1h)</div>
				<div class="text-2xl font-bold mt-1">{totalRequests.toLocaleString()}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Errors (4xx+5xx)</div>
				<div class="text-2xl font-bold mt-1 text-red-500">{errorCount.toLocaleString()}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Error Rate</div>
				<div class="text-2xl font-bold mt-1">
					{totalRequests > 0 ? ((errorCount / totalRequests) * 100).toFixed(1) : "0"}%
				</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Slowest Endpoint</div>
				<div class="text-2xl font-bold mt-1">
					{slowEndpoints[0]?.value ?? "—"}<span class="text-sm font-normal text-gray-400">ms</span>
				</div>
				<div class="text-xs text-gray-400 mt-0.5 truncate">{slowEndpoints[0]?.path ?? ""}</div>
			</div>
		</div>

		<!-- Status code distribution -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<h3 class="text-sm font-semibold mb-4">Status Code Distribution (1h)</h3>
			{#if statusCounts.length === 0}
				<p class="text-sm text-gray-400">No request logs found — deploy the JSON logger first.</p>
			{:else}
				<div class="space-y-2">
					{#each statusCounts.sort((a, b) => a.status.localeCompare(b.status)) as s}
						<div class="flex items-center gap-3">
							<span class="text-sm font-mono w-12">{s.status}</span>
							<div class="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-6 overflow-hidden">
								<div
									class="h-full {statusClass(s.status)} transition-all"
									style="width: {totalRequests > 0 ? (s.count / totalRequests) * 100 : 0}%"
								></div>
							</div>
							<span class="text-sm text-gray-500 w-16 text-right">{s.count.toLocaleString()}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
			<!-- Slowest endpoints -->
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
				<h3 class="text-sm font-semibold mb-3">Top 10 Slowest Endpoints (avg ms, 1h)</h3>
				{#if slowEndpoints.length === 0}
					<p class="text-sm text-gray-400">No data</p>
				{:else}
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-xs text-gray-400 border-b border-gray-200 dark:border-gray-800">
								<th class="pb-2 font-medium">Path</th>
								<th class="pb-2 font-medium text-right">Avg ms</th>
							</tr>
						</thead>
						<tbody>
							{#each slowEndpoints as e}
								<tr class="border-b border-gray-100 dark:border-gray-800/50">
									<td class="py-2 font-mono text-xs truncate max-w-[200px]">{e.path}</td>
									<td class="py-2 text-right font-medium">{e.value}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>

			<!-- Endpoints with most errors -->
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
				<h3 class="text-sm font-semibold mb-3">Endpoints with Most Errors (1h)</h3>
				{#if errorEndpoints.length === 0}
					<p class="text-sm text-gray-400">No errors 🎉</p>
				{:else}
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-xs text-gray-400 border-b border-gray-200 dark:border-gray-800">
								<th class="pb-2 font-medium">Path</th>
								<th class="pb-2 font-medium text-right">Errors</th>
							</tr>
						</thead>
						<tbody>
							{#each errorEndpoints as e}
								<tr class="border-b border-gray-100 dark:border-gray-800/50">
									<td class="py-2 font-mono text-xs truncate max-w-[200px]">{e.path}</td>
									<td class="py-2 text-right font-medium text-red-500">{e.value}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>
		</div>

		<!-- Server errors from DB (genuine exceptions, not routine 4xx) -->
		{#if dbErrors.length > 0}
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
				<h3 class="text-sm font-semibold mb-3">Server Errors ({dbErrors.length})</h3>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
											<tr class="text-left text-xs text-gray-400 border-b border-gray-200 dark:border-gray-800">
												<th class="pb-2 font-medium">Time</th>
												<th class="pb-2 font-medium">Error</th>
												<th class="pb-2 font-medium">Status</th>
												<th class="pb-2 font-medium">Method</th>
												<th class="pb-2 font-medium">URL</th>
												<th class="pb-2 font-medium">Req ID</th>
											</tr>
										</thead>
										<tbody>
											{#each dbErrors as err}
												<tr class="border-b border-gray-100 dark:border-gray-800/50">
													<td class="py-2 text-xs text-gray-400 whitespace-nowrap">{err.createdAt ? new Date(err.createdAt).toLocaleString() : "—"}</td>
													<td class="py-2"><span class="font-mono text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">{err.error.name}</span><span class="ml-2 text-xs text-gray-500 dark:text-gray-400">{err.error.message}</span></td>
													<td class="py-2"><span class="font-mono text-xs px-1.5 py-0.5 rounded {Number(err.request.status) >= 500 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'}">{err.request.status ?? "—"}</span></td>
													<td class="py-2 font-mono text-xs">{err.request.method}</td>
													<td class="py-2 font-mono text-xs truncate max-w-[200px]">{err.request.url}</td>
													<td class="py-2 font-mono text-[10px] text-gray-400 truncate max-w-[120px]">{err.request.id ?? "—"}</td>
												</tr>
											{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- Recent log stream (Loki) -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<div class="flex items-center justify-between mb-3">
				<h3 class="text-sm font-semibold">Recent Logs (warnings & errors)</h3>
				<a
					href="https://grafana.boardgamers.space/d/bgs-health"
					target="_blank"
					rel="noopener"
					class="text-xs text-blue-600 dark:text-blue-400 hover:underline">Open in Grafana →</a
				>
			</div>
			{#if recentErrors.length === 0}
				<p class="text-sm text-gray-400">No recent errors</p>
			{:else}
				<div class="space-y-1.5 max-h-96 overflow-y-auto">
					{#each recentErrors.slice(0, 50) as err}
						<div class="flex items-start gap-2 text-xs py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
							<span
								class="px-1.5 py-0.5 rounded font-mono text-[10px] font-medium flex-shrink-0 {err.level === 'error'
									? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
									: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'}">{err.level}</span
							>
							{#if err.status}
								<span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-medium flex-shrink-0 {Number(err.status) >= 500 ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'}">{err.status}</span>
							{/if}
							<span class="text-gray-400 font-mono w-16 flex-shrink-0">{formatTime(err.timestamp)}</span>
							<span class="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">{err.source}</span>
							{#if err.path}
								<span class="text-gray-400 dark:text-gray-500 font-mono text-[10px] flex-shrink-0 truncate max-w-[180px]">{err.path}</span>
							{:else}
								<span class="flex-1 truncate">{err.line}</span>
							{/if}
							{#if err.ip}
													<span class="text-gray-400 dark:text-gray-500 font-mono text-[10px] flex-shrink-0">{err.ip}</span>
												{/if}
												{#if err.requestId}
													<span class="text-gray-400 dark:text-gray-500 font-mono text-[10px] flex-shrink-0 truncate max-w-[100px]" title={err.requestId}>{err.requestId}</span>
												{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
