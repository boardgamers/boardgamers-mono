<script lang="ts">
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";

	// Loki query result shapes (subset of the Loki API response we use)
	interface LokiInstantResult {
		status: string;
		data: {
			resultType: "vector";
			result: { metric: Record<string, string>; value: [number, string] }[];
		};
	}
	interface LokiRangeResult {
		status: string;
		data: {
			resultType: "matrix" | "streams";
			result: { metric: Record<string, string>; values: [number, string][] }[];
		};
	}

	interface StatusCount {
		status: string;
		count: number;
	}
	interface EndpointStat {
		path: string;
		value: number;
	}
	interface ErrorLog {
		timestamp: number;
		line: string;
		source: string;
		level: string;
	}

	let loading = $state(true);
	let statusCounts = $state<StatusCount[]>([]);
	let slowEndpoints = $state<EndpointStat[]>([]);
	let errorEndpoints = $state<EndpointStat[]>([]);
	let recentErrors = $state<ErrorLog[]>([]);
	let lastUpdated = $state<Date | null>(null);

	$effect(() => {
		loadHealth();
	});

	async function loadHealth() {
		loading = true;
		try {
			const [status, slow, errors, logs] = await Promise.all([
				api.get<LokiInstantResult>("/admin/loki/query/statusCounts"),
				api.get<LokiInstantResult>("/admin/loki/query/slowEndpoints"),
				api.get<LokiInstantResult>("/admin/loki/query/errorEndpoints"),
				api.get<LokiRangeResult>("/admin/loki/query/recentErrors?limit=50"),
			]);

			statusCounts = (status.data.result ?? []).map((r) => ({
				status: r.metric.status ?? "?",
				count: Math.round(Number(r.value[1])),
			}));

			slowEndpoints = (slow.data.result ?? []).map((r) => ({
				path: r.metric.path ?? "?",
				value: Math.round(Number(r.value[1])),
			}));

			errorEndpoints = (errors.data.result ?? []).map((r) => ({
				path: r.metric.path ?? "?",
				value: Math.round(Number(r.value[1])),
			}));

			recentErrors = (logs.data.result ?? []).flatMap((stream) =>
				(stream.values ?? []).map(([ts, line]) => {
					let parsed: Record<string, unknown> = {};
					try {
						parsed = JSON.parse(line);
					} catch {
						// non-JSON line (morgan format, stack trace)
					}
					return {
						timestamp: ts,
						line: typeof parsed.msg === "string" ? (parsed as { msg: string }).msg : line,
						source: (parsed.source as string) ?? stream.metric.source ?? "?",
						level: (parsed.level as string) ?? stream.metric.level ?? "?",
					};
				}),
			);

			lastUpdated = new Date();
		} catch {
			toast.error("Failed to load health data — is Loki running?");
		} finally {
			loading = false;
		}
	}

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
			{#if lastUpdated}
				<p class="text-xs text-gray-400 mt-0.5">Last updated {lastUpdated.toLocaleTimeString()}</p>
			{/if}
		</div>
		<button
			onclick={loadHealth}
			class="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
		>
			Refresh
		</button>
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<div
				class="w-8 h-8 border-4 border-gray-300 dark:border-gray-600 border-t-blue-600 rounded-full animate-spin"
			></div>
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

		<!-- Recent errors stream -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<div class="flex items-center justify-between mb-3">
				<h3 class="text-sm font-semibold">Recent Errors & Warnings</h3>
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
						<div class="flex items-start gap-3 text-xs py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
							<span
								class="px-1.5 py-0.5 rounded font-mono text-[10px] font-medium {err.level === 'error'
									? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
									: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'}">{err.level}</span
							>
							<span class="text-gray-400 font-mono w-16 flex-shrink-0">{formatTime(err.timestamp)}</span>
							<span class="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">{err.source}</span>
							<span class="flex-1 truncate">{err.line}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
