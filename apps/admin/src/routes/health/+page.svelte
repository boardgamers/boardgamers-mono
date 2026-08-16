<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { untrack } from "svelte";
	import { api, ApiError } from "$lib/api.ts";
	import type { PageProps } from "./$types";
	import type { ApiErrorEntry } from "./+page.ts";

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

	interface RecentError {
		timestamp: number;
		line: string;
		source: string;
		level: string;
		status?: string;
		path?: string;
		route?: string;
		ip?: string;
		requestId?: string;
	}

	let { data }: PageProps = $props();

	let refreshing = $state(false);

	async function refresh() {
		refreshing = true;
		try {
			await Promise.all([invalidateAll(), loadLoki()]);
		} finally {
			refreshing = false;
		}
	}

	const health = $derived(data.health);
	const dbErrorsTotal = $derived(health.dbErrorsTotal);
	let dbErrorsPage = $state(1);
	let dbErrorsLoading = $state(false);
	// Mutable (loadMoreErrors appends pages); the $effect re-syncs it whenever the
	// load data refreshes (untrack reads the initial value once).
	let allDbErrors = $state<ApiErrorEntry[]>(untrack(() => [...data.health.dbErrors]));
	let hasMoreDbErrors = $derived(allDbErrors.length < dbErrorsTotal);

	$effect(() => {
		// Reset on refresh
		allDbErrors = [...health.dbErrors];
		dbErrorsPage = 1;
	});

	// --- Loki-backed panels, fetched client-side ---------------------------
	// `undefined` = still loading, `null` = Loki unavailable. Keeping these out of
	// the SSR `load` means the page renders the DB summary immediately and the
	// Loki panels fill in when (and if) Loki answers.
	let lokiLoading = $state(true);
	let lokiAvailable = $state<boolean | null>(null);
	let statusCounts = $state<{ status: string; count: number }[]>([]);
	let slowEndpoints = $state<{ route: string; value: number }[]>([]);
	let errorEndpoints = $state<{ route: string; value: number }[]>([]);
	let recentErrors = $state<RecentError[]>([]);

	async function loadLoki() {
		lokiLoading = true;
		const results = await Promise.allSettled([
			api.get<LokiInstantResult>("/admin/loki/query/statusCounts"),
			api.get<LokiInstantResult>("/admin/loki/query/slowEndpoints"),
			api.get<LokiInstantResult>("/admin/loki/query/errorEndpoints"),
			api.get<LokiRangeResult>("/admin/loki/query/recentErrors?limit=50"),
		]);

		// All four queries hit the same Loki instance. A 502/503 means Loki itself is
		// down — degrade gracefully. Any other failure (401, 500, network) is a real
		// error, but it still shouldn't blank the whole page — treat it as unavailable.
		const lokiDown = results.some(
			(r) => r.status === "rejected" && r.reason instanceof ApiError && [502, 503].includes(r.reason.status)
		);
		if (lokiDown || !results.every((r) => r.status === "fulfilled")) {
			lokiAvailable = false;
			lokiLoading = false;
			return;
		}

		const fulfilled = results as PromiseFulfilledResult<LokiInstantResult | LokiRangeResult>[];
		const status = fulfilled[0] as PromiseFulfilledResult<LokiInstantResult>;
		const slow = fulfilled[1] as PromiseFulfilledResult<LokiInstantResult>;
		const errors = fulfilled[2] as PromiseFulfilledResult<LokiInstantResult>;
		const logs = fulfilled[3] as PromiseFulfilledResult<LokiRangeResult>;

		statusCounts = (status.value.data.result ?? []).map((r) => ({
			status: r.metric.status ?? "?",
			count: Math.round(Number(r.value[1])),
		}));
		slowEndpoints = (slow.value.data.result ?? []).map((r) => ({
			route: r.metric.route ?? r.metric.path ?? "?",
			value: Math.round(Number(r.value[1])),
		}));
		errorEndpoints = (errors.value.data.result ?? []).map((r) => ({
			route: r.metric.route ?? r.metric.path ?? "?",
			value: Math.round(Number(r.value[1])),
		}));
		recentErrors = (logs.value.data.result ?? []).flatMap((stream) =>
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
					status: parsed.status != null ? String(parsed.status) : undefined,
					path: (parsed.path as string) ?? undefined,
					route: (parsed.route as string) ?? undefined,
					ip: (parsed.ip as string) ?? undefined,
					requestId: (parsed.requestId as string) ?? undefined,
				};
			})
		);
		lokiAvailable = true;
		lokiLoading = false;
	}

	const sortedSlowEndpoints = $derived([...slowEndpoints].sort((a, b) => b.value - a.value));
	const sortedErrorEndpoints = $derived([...errorEndpoints].sort((a, b) => b.value - a.value));

	async function loadMoreErrors() {
		if (dbErrorsLoading) return;
		dbErrorsLoading = true;
		try {
			const res = await api.get<{ errors: ApiErrorEntry[]; total: number }>(
				`/admin/errors?page=${dbErrorsPage + 1}&limit=20`
			);
			allDbErrors = [...allDbErrors, ...res.errors];
			dbErrorsPage++;
		} catch {
			// ignore
		} finally {
			dbErrorsLoading = false;
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
	// Exclude 401s (routine auth checks) from the error count — they're not real errors.
	const errorCount = $derived(
		statusCounts.filter((s) => Number(s.status) >= 400 && s.status !== "401").reduce((a, b) => a + b.count, 0)
	);

	loadLoki();
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

	{#if lokiLoading}
		<div
			class="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl"
		>
			<div class="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
			<div class="text-sm text-gray-400">Loading request metrics…</div>
		</div>
	{:else if !lokiAvailable}
		<div
			class="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl"
		>
			<span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500"></span>
			<div class="text-sm">
				<span class="font-medium text-amber-700 dark:text-amber-400">Loki is unavailable.</span>
				<span class="text-amber-600 dark:text-amber-500/80">
					Logging is not running, so Loki-based metrics are unavailable.</span
				>
			</div>
		</div>
		<!-- DB-only summary when Loki is down -->
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">DB Errors</div>
				<div class="text-2xl font-bold mt-1 text-red-500">{dbErrorsTotal.toLocaleString()}</div>
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
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Errors (5xx + 4xx¬401)</div>
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
					{sortedSlowEndpoints[0]?.value ?? "—"}<span class="text-sm font-normal text-gray-400">ms</span>
				</div>
				<div class="text-xs text-gray-400 mt-0.5 truncate">{sortedSlowEndpoints[0]?.route ?? ""}</div>
			</div>
		</div>

		<!-- Status code distribution -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<h3 class="text-sm font-semibold mb-4">Status Code Distribution (1h)</h3>
			{#if statusCounts.length === 0}
				<p class="text-sm text-gray-400">No request logs found — deploy the JSON logger first.</p>
			{:else}
				<div class="space-y-2">
					{#each statusCounts.sort((a, b) => a.status.localeCompare(b.status)) as s (s.status)}
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
				{#if sortedSlowEndpoints.length === 0}
					<p class="text-sm text-gray-400">No data</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-xs text-gray-400 border-b border-gray-200 dark:border-gray-800">
									<th class="pb-2 font-medium">Route</th>
									<th class="pb-2 font-medium text-right">Avg ms</th>
								</tr>
							</thead>
							<tbody>
								{#each sortedSlowEndpoints as e (e.route)}
									<tr class="border-b border-gray-100 dark:border-gray-800/50">
										<td class="py-2 font-mono text-xs truncate max-w-[200px]">{e.route}</td>
										<td class="py-2 text-right font-medium">{e.value}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<!-- Endpoints with most errors -->
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
				<h3 class="text-sm font-semibold mb-3">Endpoints with Most Errors (1h)</h3>
				{#if sortedErrorEndpoints.length === 0}
					<p class="text-sm text-gray-400">No errors 🎉</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-xs text-gray-400 border-b border-gray-200 dark:border-gray-800">
									<th class="pb-2 font-medium">Route</th>
									<th class="pb-2 font-medium text-right">Errors</th>
								</tr>
							</thead>
							<tbody>
								{#each sortedErrorEndpoints as e (e.route)}
									<tr class="border-b border-gray-100 dark:border-gray-800/50">
										<td class="py-2 font-mono text-xs truncate max-w-[200px]">{e.route}</td>
										<td class="py-2 text-right font-medium text-red-500">{e.value}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Server errors from DB (genuine exceptions, not routine 4xx) -->
	{#if allDbErrors.length > 0}
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<h3 class="text-sm font-semibold mb-3">Server Errors ({allDbErrors.length} of {dbErrorsTotal})</h3>
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
						{#each allDbErrors as err (String(err._id))}
							<tr class="border-b border-gray-100 dark:border-gray-800/50">
								<td class="py-2 text-xs text-gray-400 whitespace-nowrap"
									>{err.createdAt ? new Date(err.createdAt).toLocaleString() : "—"}</td
								>
								<td class="py-2"
									><span
										class="font-mono text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
										>{err.error.name}</span
									><span class="ml-2 text-xs text-gray-500 dark:text-gray-400">{err.error.message}</span></td
								>
								<td class="py-2"
									><span
										class="font-mono text-xs px-1.5 py-0.5 rounded {Number(err.request.status) >= 500
											? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
											: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'}"
										>{err.request.status ?? "—"}</span
									></td
								>
								<td class="py-2 font-mono text-xs">{err.request.method}</td>
								<td class="py-2 font-mono text-xs truncate max-w-[200px]">{err.request.url}</td>
								<td class="py-2 font-mono text-[10px] text-gray-400 truncate max-w-[120px]">{err.request.id ?? "—"}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if hasMoreDbErrors}
				<button
					onclick={loadMoreErrors}
					disabled={dbErrorsLoading}
					class="mt-3 px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
				>
					{dbErrorsLoading ? "Loading…" : `Load more (${dbErrorsTotal - allDbErrors.length} remaining)`}
				</button>
			{/if}
		</div>
	{/if}

	{#if lokiAvailable}
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
					<!-- Index in key: the same requestId can appear twice (two PM2 workers log the
					     same request, or a request logs both a warn and an error line), which would
					     throw Svelte's each_key_duplicate. -->
					{#each recentErrors.slice(0, 50) as err, i (`${i}:${err.requestId ?? `${err.timestamp}:${err.line}`}`)}
						<div class="flex items-start gap-2 text-xs py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
							<span
								class="px-1.5 py-0.5 rounded font-mono text-[10px] font-medium flex-shrink-0 {err.level === 'error'
									? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
									: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'}">{err.level}</span
							>
							{#if err.status}
								<span
									class="px-1.5 py-0.5 rounded font-mono text-[10px] font-medium flex-shrink-0 {Number(err.status) >=
									500
										? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
										: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'}">{err.status}</span
								>
							{/if}
							<span class="text-gray-400 font-mono w-16 flex-shrink-0">{formatTime(err.timestamp)}</span>
							<span class="text-gray-500 dark:text-gray-400 w-20 flex-shrink-0">{err.source}</span>
							{#if err.route ?? err.path}
								<span
									class="text-gray-400 dark:text-gray-500 font-mono text-[10px] flex-shrink-0 truncate max-w-[180px]"
									>{err.route ?? err.path}</span
								>
							{:else}
								<span class="flex-1 truncate">{err.line}</span>
							{/if}
							{#if err.ip}
								<span class="text-gray-400 dark:text-gray-500 font-mono text-[10px] flex-shrink-0">{err.ip}</span>
							{/if}
							{#if err.requestId}
								<span
									class="text-gray-400 dark:text-gray-500 font-mono text-[10px] flex-shrink-0 truncate max-w-[100px]"
									title={err.requestId}>{err.requestId}</span
								>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
