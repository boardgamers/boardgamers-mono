<script lang="ts">
	import { resolve } from "$app/paths";
	import { SvelteMap } from "svelte/reactivity";
	import type { HangsData } from "./+page.ts";

	let { data }: { data: HangsData } = $props();

	const hangs = $derived(data.hangs);

	// Group by game+version+action to spot a repeat-offender engine at a glance.
	const byEngine = $derived(() => {
		const map = new SvelteMap<string, number>();
		for (const h of hangs) {
			const key = `${h.meta?.game ?? "?"} v${h.meta?.version ?? "?"} · ${h.meta?.action ?? "?"}`;
			map.set(key, (map.get(key) ?? 0) + 1);
		}
		return [...map.entries()].sort((a, b) => b[1] - a[1]);
	});
</script>

<div class="p-6 max-w-6xl">
	<div class="flex items-baseline justify-between mb-1">
		<h1 class="text-2xl font-bold">Engine hangs / timeouts</h1>
		<span class="text-sm text-gray-500 dark:text-gray-400">{data.total} total</span>
	</div>
	<p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
		A game engine that exceeded its per-call time budget and was terminated (runaway / infinite loop). These are the
		culprits behind game-server hangs — see <code>engine-runner.ts</code>. Recorded as <code>EngineTimeoutError</code>.
	</p>

	{#if hangs.length === 0}
		<div
			class="rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-500 dark:text-gray-400"
		>
			No engine timeouts recorded.
		</div>
	{:else}
		<h2 class="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">By engine</h2>
		<div class="flex flex-wrap gap-2 mb-6">
			{#each byEngine() as [engine, count] (engine)}
				<span
					class="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 font-medium"
					>{engine} × {count}</span
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
						<th class="px-3 py-2 font-medium">Game</th>
						<th class="px-3 py-2 font-medium">Version</th>
						<th class="px-3 py-2 font-medium">Action</th>
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
							<td class="px-3 py-2 font-medium">{h.meta?.game ?? "—"}</td>
							<td class="px-3 py-2 text-gray-500 dark:text-gray-400">v{h.meta?.version ?? "—"}</td>
							<td class="px-3 py-2"
								><span
									class="font-mono text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
									>{h.meta?.action ?? "—"}</span
								></td
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
