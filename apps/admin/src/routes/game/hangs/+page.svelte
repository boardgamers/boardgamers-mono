<script lang="ts">
	import { resolve } from "$app/paths";
	import { SvelteMap } from "svelte/reactivity";
	import type { HangsData } from "./+page.ts";

	let { data }: { data: HangsData } = $props();

	const hangs = $derived(data.hangs);

	const isSlow = (h: HangsData["hangs"][number]) => h.error.name === "SlowEngineCall";
	// Timeouts carry the worker-thread action (move); slow calls carry the main-thread method.
	const call = (h: HangsData["hangs"][number]) => h.meta?.action ?? h.meta?.method ?? "?";

	// Group by game+version+call+kind to spot a repeat-offender engine at a glance.
	const byEngine = $derived(() => {
		const map = new SvelteMap<string, { count: number; slow: boolean }>();
		for (const h of hangs) {
			const key = `${h.meta?.game ?? "?"} v${h.meta?.version ?? "?"} · ${call(h)}${isSlow(h) ? " · slow" : ""}`;
			map.set(key, { count: (map.get(key)?.count ?? 0) + 1, slow: isSlow(h) });
		}
		return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
	});
</script>

<div class="p-6 max-w-6xl">
	<div class="flex items-baseline justify-between mb-1">
		<h1 class="text-2xl font-bold">Engine hangs / timeouts</h1>
		<span class="text-sm text-gray-500 dark:text-gray-400">{data.total} total</span>
	</div>
	<p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
		<span class="font-medium text-red-600 dark:text-red-400">timeout</span> = a game engine exceeded its per-call time
		budget and was terminated (runaway / infinite loop, <code>EngineTimeoutError</code> — the move failed).
		<span class="font-medium text-amber-600 dark:text-amber-400">slow</span> = a main-thread engine call that completed
		but overran the slow threshold (<code>SlowEngineCall</code>) — the early-warning trail before an actual freeze. See
		<code>engine-runner.ts</code> / <code>engine-call-context.ts</code>.
	</p>

	{#if hangs.length === 0}
		<div
			class="rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-500 dark:text-gray-400"
		>
			No engine timeouts or slow calls recorded.
		</div>
	{:else}
		<h2 class="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">By engine</h2>
		<div class="flex flex-wrap gap-2 mb-6">
			{#each byEngine() as [engine, info] (engine)}
				<span
					class="text-xs px-2 py-1 rounded-full font-medium {info.slow
						? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
						: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'}">{engine} × {info.count}</span
				>
			{/each}
		</div>

		<div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
			<table class="w-full text-sm">
				<thead>
					<tr
						class="text-left text-xs text-gray-400 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50"
					>
						<th class="px-3 py-2 font-medium">Time</th>
						<th class="px-3 py-2 font-medium">Kind</th>
						<th class="px-3 py-2 font-medium">Game</th>
						<th class="px-3 py-2 font-medium">Version</th>
						<th class="px-3 py-2 font-medium">Call</th>
						<th class="px-3 py-2 font-medium">Player</th>
						<th class="px-3 py-2 font-medium">Move</th>
						<th class="px-3 py-2 font-medium">Duration</th>
						<th class="px-3 py-2 font-medium">Game ID</th>
						<th class="px-3 py-2 font-medium">Detail</th>
					</tr>
				</thead>
				<tbody>
					{#each hangs as h (String(h._id))}
						<tr class="border-b border-gray-100 dark:border-gray-800/50">
							<td class="px-3 py-2 text-xs text-gray-400 whitespace-nowrap"
								>{h.createdAt ? new Date(h.createdAt).toLocaleString() : "—"}</td
							>
							<td class="px-3 py-2">
								{#if isSlow(h)}
									<span
										class="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
										title="Completed, but overran the slow-call threshold">slow</span
									>
								{:else}
									<span
										class="text-xs px-1.5 py-0.5 rounded font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
										title="Killed at the engine-call timeout — the move failed">timeout</span
									>
								{/if}
							</td>
							<td class="px-3 py-2 font-medium">{h.meta?.game ?? "—"}</td>
							<td class="px-3 py-2 text-gray-500 dark:text-gray-400">v{h.meta?.version ?? "—"}</td>
							<td class="px-3 py-2"
								><span
									class="font-mono text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
									>{call(h)}</span
								></td
							>
							<td class="px-3 py-2 whitespace-nowrap">
								{h.meta?.playerName ?? "—"}
								{#if h.meta?.playerIndex !== undefined}
									<span class="text-xs text-gray-400">(#{h.meta.playerIndex})</span>
								{/if}
							</td>
							<td class="px-3 py-2 font-mono text-xs max-w-[180px] truncate" title={String(h.meta?.move ?? "")}
								>{h.meta?.move ?? "—"}</td
							>
							<td class="px-3 py-2 text-xs whitespace-nowrap text-gray-500 dark:text-gray-400"
								>{h.meta?.elapsedMs !== undefined ? `${h.meta.elapsedMs} ms` : "—"}</td
							>
							<td class="px-3 py-2 font-mono text-xs">
								{#if h.meta?.gameId}
									<a
										class="text-blue-600 dark:text-blue-400 hover:underline"
										href={resolve("/game/[gameId]", { gameId: h.meta.gameId })}>{h.meta.gameId}</a
									>
								{:else}
									—
								{/if}
							</td>
							<td
								class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 max-w-[280px] truncate"
								title={h.error.message}>{h.error.message}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
