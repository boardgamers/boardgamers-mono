<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { loadTranslationsOverview, startBulkTranslate, type ListedBulkTranslateJob } from "$lib/api.ts";
	import { can } from "$lib/permissions.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo } from "$lib/utils.ts";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const overview = $derived(data.overview);
	const me = $derived(data.me);

	// Poll while any job is running; stop when all are terminal.
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		clearTimeout(pollTimer);
		if (overview?.jobs.some((j) => j.status === "running")) {
			pollTimer = setTimeout(() => invalidateAll(), 3000);
		}
		return () => clearTimeout(pollTimer);
	});

	let expandedJobs = $state<Record<string, boolean>>({});
	let refreshing = $state<Record<string, boolean>>({});

	async function refreshLang(lang: string) {
		if (refreshing[lang]) return;
		refreshing[lang] = true;
		try {
			await startBulkTranslate({ targetLang: lang });
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Bulk translation failed");
		} finally {
			refreshing[lang] = false;
		}
	}

	function statusBadge(job: ListedBulkTranslateJob): { label: string; cls: string } {
		const interrupted = job.status === "error" && job.errors.some((e) => e.message.includes("interrupted"));
		if (job.status === "running") {
			return { label: "running", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" };
		}
		if (interrupted) {
			return { label: "interrupted", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" };
		}
		if (job.status === "error" || job.errors.length > 0) {
			return { label: job.status === "error" ? "error" : "done w/ errors", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" };
		}
		return { label: "done", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
	}

	const cellCls: Record<string, string> = {
		ok: "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300",
		outdated: "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300",
		missing: "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500",
	};
</script>

<div class="p-6 max-w-6xl mx-auto">
	<h1 class="text-2xl font-bold mb-6">Translations</h1>

	{#if !overview}
		<p class="text-gray-500 dark:text-gray-400">Failed to load the translations overview.</p>
	{:else}
		<!-- Jobs -->
		<section class="mb-10">
			<h2 class="text-lg font-semibold mb-3">Bulk translation jobs</h2>
			{#if overview.jobs.length === 0}
				<p class="text-sm text-gray-500 dark:text-gray-400">No bulk translation jobs yet.</p>
			{:else}
				<div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800">
								<th class="px-3 py-2">Status</th>
								<th class="px-3 py-2">Progress</th>
								<th class="px-3 py-2">Translated</th>
								<th class="px-3 py-2">Skipped</th>
								<th class="px-3 py-2">Errors</th>
								<th class="px-3 py-2">Current</th>
								<th class="px-3 py-2">Created</th>
								<th class="px-3 py-2">Updated</th>
							</tr>
						</thead>
						<tbody>
							{#each overview.jobs as job (job.jobId)}
								{@const badge = statusBadge(job)}
								<tr class="border-b border-gray-100 dark:border-gray-800/60 align-top">
									<td class="px-3 py-2">
										<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {badge.cls}">{badge.label}</span>
									</td>
									<td class="px-3 py-2 tabular-nums">{job.done}/{job.total}</td>
									<td class="px-3 py-2 tabular-nums">{job.translated}</td>
									<td class="px-3 py-2 tabular-nums">{job.skipped}</td>
									<td class="px-3 py-2">
										{#if job.errors.length > 0}
											<button
												onclick={() => (expandedJobs[job.jobId] = !expandedJobs[job.jobId])}
												class="text-red-600 dark:text-red-400 hover:underline text-xs"
											>
												{job.errors.length} error{job.errors.length === 1 ? "" : "s"}
												{expandedJobs[job.jobId] ? "▲" : "▼"}
											</button>
										{:else}
											<span class="text-gray-400">—</span>
										{/if}
									</td>
									<td class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
										{#if job.status === "running" && job.current}
											{job.current.page} → {job.current.lang}
										{:else}
											—
										{/if}
									</td>
									<td class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{timeAgo(job.createdAt)}</td>
									<td class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{timeAgo(job.updatedAt)}</td>
								</tr>
								{#if expandedJobs[job.jobId] && job.errors.length > 0}
									<tr class="border-b border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-900/40">
										<td colspan="8" class="px-4 py-2">
											<ul class="text-xs space-y-1">
												{#each job.errors as err, i (i)}
													<li>
														<span class="font-mono text-gray-500 dark:text-gray-400">{err.page} → {err.lang}:</span>
														<span class="text-red-600 dark:text-red-400">{err.message}</span>
													</li>
												{/each}
											</ul>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<!-- Pages matrix -->
		<section class="mb-10">
			<h2 class="text-lg font-semibold mb-1">Pages</h2>
			<p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
				One cell per page × locale. Click a cell to open the editor.
			</p>
			<div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
				<table class="text-sm">
					<thead>
						<tr class="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800">
							<th class="px-3 py-2 sticky left-0 bg-white dark:bg-gray-900">Page</th>
							{#each overview.locales as lang (lang)}
								<th class="px-2 py-2 text-center">
									<div>{lang}</div>
									{#if lang !== "en" && can(me, "pages")}
										<button
											onclick={() => refreshLang(lang)}
											disabled={!!refreshing[lang]}
											title="LLM-translate every page missing or outdated in {lang}"
											class="mt-0.5 text-[10px] font-normal normal-case rounded border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 px-1 py-px hover:bg-violet-50 dark:hover:bg-violet-950 disabled:opacity-50"
										>
											{refreshing[lang] ? "…" : "refresh"}
										</button>
									{/if}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each overview.pages as row (row.name)}
							<tr class="border-b border-gray-100 dark:border-gray-800/60">
								<td class="px-3 py-1.5 sticky left-0 bg-white dark:bg-gray-900 whitespace-nowrap max-w-64 truncate" title={row.title}>
									{row.name}
								</td>
								{#each overview.locales as lang (lang)}
									{@const cell = row.cells[lang]}
									<td class="px-1 py-1 text-center">
										<a
											href={resolve("/page/[name]/[lang]", { name: row.name, lang })}
											title="{row.name} ({lang}): {cell?.status ?? 'missing'}"
											class="inline-block w-6 h-6 rounded text-[10px] leading-6 font-medium {cellCls[cell?.status ?? 'missing']}"
										>
											{cell?.status === "ok" ? "✓" : cell?.status === "outdated" ? "!" : "·"}
										</a>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="flex gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
				<span><span class="inline-block w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900/60 align-middle"></span> ok</span>
				<span><span class="inline-block w-3 h-3 rounded bg-amber-200 dark:bg-amber-900/60 align-middle"></span> outdated</span>
				<span><span class="inline-block w-3 h-3 rounded bg-gray-200 dark:bg-gray-800 align-middle"></span> missing</span>
			</div>
		</section>

		<!-- Game metadata -->
		<section>
			<h2 class="text-lg font-semibold mb-1">Game metadata</h2>
			<p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
				Whether each game has a translations overlay per locale (description / rules / credits). No outdated
				tracking exists for metadata — presence only.
			</p>
			<div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
				<table class="text-sm">
					<thead>
						<tr class="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800">
							<th class="px-3 py-2 sticky left-0 bg-white dark:bg-gray-900">Game</th>
							{#each overview.metaLangs as lang (lang)}
								<th class="px-2 py-2 text-center">{lang}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each overview.games as row (row.game)}
							<tr class="border-b border-gray-100 dark:border-gray-800/60">
								<td class="px-3 py-1.5 sticky left-0 bg-white dark:bg-gray-900 whitespace-nowrap max-w-64 truncate">
									<a href={resolve("/boardgame/[game]", { game: row.game })} class="hover:underline" title={row.label}>
										{row.alias ?? row.label}
									</a>
								</td>
								{#each overview.metaLangs as lang (lang)}
									{@const cell = row.cells[lang]}
									<td class="px-1 py-1 text-center">
										<span
											title="{row.game} ({lang}): {cell?.translated ? `translated (${cell.fields.join(', ')})` : 'no translation'}"
											class="inline-block w-6 h-6 rounded text-[10px] leading-6 font-medium {cell?.translated
												? cellCls.ok
												: cellCls.missing}"
										>
											{cell?.translated ? "✓" : "·"}
										</span>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
