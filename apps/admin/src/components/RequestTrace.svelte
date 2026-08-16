<script lang="ts">
	import { api, ApiError } from "$lib/api.ts";

	interface LokiRangeResult {
		status: string;
		data: {
			resultType: "matrix" | "streams";
			result: { metric: Record<string, string>; values: [number, string][] }[];
		};
	}

	interface TraceLine {
		timestamp: number;
		raw: string;
		parsed: Record<string, unknown> | null;
	}

	let { requestId, onclose }: { requestId: string; onclose: () => void } = $props();

	let loading = $state(true);
	let unavailable = $state(false);
	let loadError = $state<string | null>(null);
	let lines = $state<TraceLine[]>([]);

	// A trace covers every hop of one request (web → api → game-server), so 500
	// lines is generous; the 6h window matches the proxy's MAX_WINDOW_MS cap.
	async function loadTrace() {
		loading = true;
		loadError = null;
		try {
			const res = await api.get<LokiRangeResult>(
				`/admin/loki/query/logsByRequestId?requestId=${encodeURIComponent(requestId)}&limit=500`
			);
			lines = (res.data.result ?? [])
				.flatMap((stream) =>
					(stream.values ?? []).map(([ts, raw]) => {
						let parsed: Record<string, unknown> | null = null;
						try {
							parsed = JSON.parse(raw);
						} catch {
							// non-JSON line (stack-trace continuation, morgan) — shown raw
						}
						return { timestamp: ts, raw, parsed };
					})
				)
				.toSorted((a, b) => a.timestamp - b.timestamp);
		} catch (err) {
			if (err instanceof ApiError && [502, 503].includes(err.status)) {
				unavailable = true;
			} else {
				loadError = err instanceof Error ? err.message : String(err);
			}
		} finally {
			loading = false;
		}
	}

	function str(line: TraceLine, field: string): string | undefined {
		const value = line.parsed?.[field];
		return typeof value === "string" ? value : undefined;
	}

	function num(line: TraceLine, field: string): number | undefined {
		const value = line.parsed?.[field];
		return typeof value === "number" ? value : undefined;
	}

	function levelOf(line: TraceLine): string {
		return str(line, "level") ?? "info";
	}

	function timeOf(line: TraceLine): string {
		const time = str(line, "time");
		if (time) {
			const d = new Date(time);
			return `${d.toLocaleTimeString(undefined, { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
		}
		// Loki returns nanosecond timestamps
		return new Date(Math.floor(line.timestamp / 1_000_000)).toLocaleTimeString();
	}

	function levelBadgeClass(level: string): string {
		if (level === "error") {
			return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400";
		}
		if (level === "warn") {
			return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400";
		}
		return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400";
	}

	function statusBadgeClass(status: number | undefined): string {
		if (status === undefined) {
			return "";
		}
		if (status >= 500) {
			return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400";
		}
		if (status >= 400) {
			return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400";
		}
		return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400";
	}

	function stackOf(line: TraceLine): string[] {
		const stack = line.parsed?.stack;
		return Array.isArray(stack) ? stack.filter((s): s is string => typeof s === "string") : [];
	}

	// Same strict shape the Loki proxy enforces server-side — the id is
	// interpolated into a LogQL string in the Grafana link, so only build the
	// link for UUID-shaped ids (the proxy would 400 anything else anyway).
	const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

	const grafanaUrl = $derived(
		REQUEST_ID_RE.test(requestId)
			? `https://grafana.boardgamers.space/explore?left=${encodeURIComponent(
					JSON.stringify({
						datasource: "Loki",
						queries: [{ expr: `{job="pm2"} | json | requestId="${requestId}"` }],
						range: { from: "now-6h", to: "now" },
					})
				)}`
			: null
	);

	loadTrace();
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onclick={onclose}>
	<div
		class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="flex items-center justify-between gap-4 px-5 py-4 border-b border-gray-200 dark:border-gray-800">
			<div class="min-w-0">
				<h3 class="text-sm font-semibold">Request trace</h3>
				<p class="font-mono text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{requestId}</p>
			</div>
			<div class="flex items-center gap-3 flex-shrink-0">
				{#if grafanaUrl}
					<!-- eslint-disable svelte/no-navigation-without-resolve -- external Grafana URL (target=_blank), resolve() is for internal paths; the rule's report range spans the whole multi-line tag -->
					<a
						href={grafanaUrl}
						target="_blank"
						rel="noopener"
						class="text-xs text-blue-600 dark:text-blue-400 hover:underline">Open in Grafana →</a
					>
				{/if}
				<button
					onclick={onclose}
					class="px-2.5 py-1 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
					aria-label="Close">✕</button
				>
			</div>
		</div>

		<div class="overflow-y-auto px-5 py-4 flex-1">
			{#if loading}
				<div class="flex items-center gap-3 py-8 justify-center">
					<div class="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
					<div class="text-sm text-gray-400">Loading trace…</div>
				</div>
			{:else if unavailable}
				<p class="text-sm text-amber-600 dark:text-amber-400 py-4">
					Loki is unavailable — the trace can't be loaded. Try the Grafana link above.
				</p>
			{:else if loadError}
				<p class="text-sm text-red-500 py-4">Failed to load the trace: {loadError}</p>
			{:else if lines.length === 0}
				<p class="text-sm text-gray-400 py-4">
					No log lines with this request id in the last 6h (older logs have expired from Loki).
				</p>
			{:else}
				<div class="space-y-2">
					{#each lines as line, i (i)}
						{@const status = num(line, "status")}
						{@const stacks = stackOf(line)}
						<div class="text-sm rounded-lg border border-gray-100 dark:border-gray-800/60 px-3 py-2">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="px-1.5 py-0.5 rounded font-mono text-xs font-medium {levelBadgeClass(levelOf(line))}"
									>{levelOf(line)}</span
								>
								<span class="text-gray-400 font-mono text-xs">{timeOf(line)}</span>
								{#if str(line, "source")}
									<span class="text-gray-500 dark:text-gray-400 text-xs">{str(line, "source")}</span>
								{/if}
								{#if str(line, "msg")}
									<span class="font-medium">{str(line, "msg")}</span>
								{/if}
								{#if str(line, "method")}
									<span class="font-mono text-xs">{str(line, "method")}</span>
								{/if}
								{#if str(line, "path")}
									<span class="font-mono text-xs break-all">{str(line, "path")}</span>
								{/if}
								{#if status !== undefined}
									<span class="px-1.5 py-0.5 rounded font-mono text-xs font-medium {statusBadgeClass(status)}"
										>{status}</span
									>
								{/if}
								{#if num(line, "durationMs") !== undefined}
									<span class="text-xs text-gray-500">{num(line, "durationMs")}ms</span>
								{/if}
							</div>
							{#if str(line, "error")}
								<div class="mt-1 text-sm text-red-600 dark:text-red-400">{str(line, "error")}</div>
							{/if}
							{#if stacks.length > 0}
								<pre
									class="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-all">{stacks.join(
										"\n"
									)}</pre>
							{/if}
							{#if str(line, "ua") ?? str(line, "referer") ?? str(line, "ip")}
								<div class="mt-1 text-xs text-gray-400 dark:text-gray-500 space-y-0.5">
									{#if str(line, "ip")}<div>ip: <span class="font-mono">{str(line, "ip")}</span></div>{/if}
									{#if str(line, "ua")}<div class="break-all">ua: {str(line, "ua")}</div>{/if}
									{#if str(line, "referer")}<div class="break-all">referer: {str(line, "referer")}</div>{/if}
								</div>
							{/if}
							{#if !line.parsed}
								<pre
									class="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-all">{line.raw}</pre>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
