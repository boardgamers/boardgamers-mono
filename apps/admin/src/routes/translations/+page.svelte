<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		loadTranslationsOverview,
		startBulkTranslate,
		startMetadataBulkTranslate,
		type ListedBulkTranslateJob,
	} from "$lib/api.ts";
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
	let metaRefreshing = $state<Record<string, boolean>>({});

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

	// Key "" = the global "all missing metadata" run.
	async function refreshMetadata(key: string, targetLang?: string) {
		if (metaRefreshing[key]) return;
		metaRefreshing[key] = true;
		try {
			await startMetadataBulkTranslate(targetLang ? { targetLang } : {});
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Bulk metadata translation failed");
		} finally {
			metaRefreshing[key] = false;
		}
	}

	// Jobs table pagination: client-side (the list is small — terminal jobs
	// are lazily reaped after 24h). Running jobs are pinned ahead of the
	// newest-first rest, so they're always on page 1 regardless of age.
	const JOBS_PER_PAGE = 10;
	let jobsPage = $state(1);
	const sortedJobs = $derived(
		[...(overview?.jobs ?? [])].sort((a, b) => Number(b.status === "running") - Number(a.status === "running"))
	);
	const jobsPageCount = $derived(Math.max(1, Math.ceil(sortedJobs.length / JOBS_PER_PAGE)));
	const currentJobsPage = $derived(Math.min(jobsPage, jobsPageCount));
	const visibleJobs = $derived(
		sortedJobs.slice((currentJobsPage - 1) * JOBS_PER_PAGE, currentJobsPage * JOBS_PER_PAGE)
	);

	function statusBadge(job: ListedBulkTranslateJob): { label: string; cls: string } {
		const interrupted = job.status === "error" && job.errors.some((e) => e.message.includes("interrupted"));
		if (job.status === "running") {
			return { label: "running", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" };
		}
		if (interrupted) {
			return { label: "interrupted", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" };
		}
		if (job.status === "error" || job.errors.length > 0) {
			return {
				label: job.status === "error" ? "error" : "done w/ errors",
				cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
			};
		}
		return { label: "done", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
	}

	const cellCls: Record<string, string> = {
		ok: "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300",
		outdated: "bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300",
		missing: "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500",
		unknown: "bg-sky-100 dark:bg-sky-900/60 text-sky-800 dark:text-sky-300",
	};

	const cellGlyph: Record<string, string> = { ok: "✓", outdated: "!", missing: "·", unknown: "?" };

	function metaCellTitle(game: string, lang: string, cell?: { status: string; fields: string[] }): string {
		const fields = cell?.fields.length ? ` (${cell.fields.join(", ")})` : "";
		switch (cell?.status) {
			case "ok":
				return `${game} (${lang}): translated${fields}`;
			case "outdated":
				return `${game} (${lang}): outdated — the English source was edited after this translation${fields}`;
			case "unknown":
				return `${game} (${lang}): translated${fields} — translated before outdated-tracking existed, freshness unknown`;
			default:
				return `${game} (${lang}): no translation`;
		}
	}
</script>

<div class="p-6 max-w-6xl mx-auto">
	<h1 class="text-2xl font-bold mb-6">Translations</h1>

	{#if !overview}
		<p class="text-gray-500 dark:text-gray-400">Failed to load the translations overview.</p>
	{:else}
		<!-- Jobs -->
		<section class="mb-10">
			<div class="flex items-baseline gap-3 mb-3">
				<h2 class="text-lg font-semibold">Bulk translation jobs</h2>
				{#if jobsPageCount > 1}
					<nav class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
						<button
							onclick={() => (jobsPage = currentJobsPage - 1)}
							disabled={currentJobsPage <= 1}
							class="rounded border border-gray-300 dark:border-gray-700 px-1.5 py-px hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
							>‹ prev</button
						>
						<span class="tabular-nums">page {currentJobsPage}/{jobsPageCount}</span>
						<button
							onclick={() => (jobsPage = currentJobsPage + 1)}
							disabled={currentJobsPage >= jobsPageCount}
							class="rounded border border-gray-300 dark:border-gray-700 px-1.5 py-px hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
							>next ›</button
						>
					</nav>
				{/if}
			</div>
			{#if overview.jobs.length === 0}
				<p class="text-sm text-gray-500 dark:text-gray-400">No bulk translation jobs yet.</p>
			{:else}
				<div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
					<table class="w-full text-sm">
						<thead>
							<tr
								class="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800"
							>
								<th class="px-3 py-2">Status</th>
								<th class="px-3 py-2">Kind</th>
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
							{#each visibleJobs as job (job.jobId)}
								{@const badge = statusBadge(job)}
								<tr class="border-b border-gray-100 dark:border-gray-800/60 align-top">
									<td class="px-3 py-2">
										<span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium {badge.cls}"
											>{badge.label}</span
										>
									</td>
									<td class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{job.kind ?? "pages"}</td>
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
									<td class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap"
										>{timeAgo(job.createdAt)}</td
									>
									<td class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap"
										>{timeAgo(job.updatedAt)}</td
									>
								</tr>
								{#if expandedJobs[job.jobId] && job.errors.length > 0}
									<tr class="border-b border-gray-100 dark:border-gray-800/60 bg-gray-50 dark:bg-gray-900/40">
										<td colspan="9" class="px-4 py-2">
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
						<tr
							class="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800"
						>
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
								<td
									class="px-3 py-1.5 sticky left-0 bg-white dark:bg-gray-900 whitespace-nowrap max-w-64 truncate"
									title={row.title}
								>
									{row.name}
								</td>
								{#each overview.locales as lang (lang)}
									{@const cell = row.cells[lang]}
									<td class="px-1 py-1 text-center">
										<a
											href={resolve("/page/[name]/[lang]", { name: row.name, lang })}
											title="{row.name} ({lang}): {cell?.status ?? 'missing'}"
											class="inline-block w-6 h-6 rounded text-[10px] leading-6 font-medium {cellCls[
												cell?.status ?? 'missing'
											]}"
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
				<span
					><span class="inline-block w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900/60 align-middle"></span> ok</span
				>
				<span
					><span class="inline-block w-3 h-3 rounded bg-amber-200 dark:bg-amber-900/60 align-middle"></span> outdated</span
				>
				<span><span class="inline-block w-3 h-3 rounded bg-gray-200 dark:bg-gray-800 align-middle"></span> missing</span
				>
			</div>
		</section>

		<!-- Game metadata -->
		<section>
			<div class="flex items-baseline gap-3 mb-1">
				<h2 class="text-lg font-semibold">Game metadata</h2>
				{#if can(me, "pages")}
					<button
						onclick={() => refreshMetadata("")}
						disabled={!!metaRefreshing[""]}
						title="LLM-translate every missing game-metadata overlay, every locale (description / rules / credits)"
						class="text-xs rounded border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 px-2 py-0.5 hover:bg-violet-50 dark:hover:bg-violet-950 disabled:opacity-50"
					>
						{metaRefreshing[""] ? "starting…" : "translate all missing"}
					</button>
				{/if}
			</div>
			<p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
				One cell per game × locale: the translations overlay's status (description / rules / credits). "unknown" =
				translated before outdated-tracking existed, so freshness can't be told from the data.
			</p>
			<div class="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
				<table class="text-sm">
					<thead>
						<tr
							class="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-gray-200 dark:border-gray-800"
						>
							<th class="px-3 py-2 sticky left-0 bg-white dark:bg-gray-900">Game</th>
							{#each overview.metaLangs as lang (lang)}
								<th class="px-2 py-2 text-center">
									<div>{lang}</div>
									{#if can(me, "pages")}
										<button
											onclick={() => refreshMetadata(lang, lang)}
											disabled={!!metaRefreshing[lang]}
											title="LLM-translate every game's missing metadata into {lang}"
											class="mt-0.5 text-[10px] font-normal normal-case rounded border border-violet-300 dark:border-violet-700 text-violet-600 dark:text-violet-400 px-1 py-px hover:bg-violet-50 dark:hover:bg-violet-950 disabled:opacity-50"
										>
											{metaRefreshing[lang] ? "…" : "translate"}
										</button>
									{/if}
								</th>
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
											title={metaCellTitle(row.game, lang, cell)}
											class="inline-block w-6 h-6 rounded text-[10px] leading-6 font-medium {cellCls[
												cell?.status ?? 'missing'
											]}"
										>
											{cellGlyph[cell?.status ?? "missing"]}
										</span>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="flex gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
				<span
					><span class="inline-block w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900/60 align-middle"></span> ok</span
				>
				<span
					><span class="inline-block w-3 h-3 rounded bg-amber-200 dark:bg-amber-900/60 align-middle"></span> outdated</span
				>
				<span
					><span class="inline-block w-3 h-3 rounded bg-sky-200 dark:bg-sky-900/60 align-middle"></span> unknown (pre-tracking)</span
				>
				<span><span class="inline-block w-3 h-3 rounded bg-gray-200 dark:bg-gray-800 align-middle"></span> missing</span
				>
			</div>
		</section>
	{/if}
</div>
