<script lang="ts">
	import { api } from "$lib/api.ts";
	import { timeAgo } from "$lib/utils.ts";

	interface AuditLogEntry {
		_id: string;
		admin: { _id: string; name: string };
		action: string;
		target?: { kind: string; id: string; label?: string };
		meta?: Record<string, unknown>;
		method: string;
		path: string;
		createdAt: string;
	}

	interface AuditLogResponse {
		logs: AuditLogEntry[];
		total: number;
		page: number;
		limit: number;
		actions: string[];
		admins: string[];
	}

	let response = $state<AuditLogResponse | null>(null);
	let loading = $state(true);
	let page = $state(1);
	const limit = 20;

	let adminFilter = $state("");
	let actionFilter = $state("");
	let targetFilter = $state("");

	const pageCount = $derived(Math.max(1, Math.ceil((response?.total ?? 0) / limit)));

	async function load(p: number) {
		loading = true;
		try {
			const params = new URLSearchParams({ page: String(p), limit: String(limit) });
			if (adminFilter) params.set("admin", adminFilter);
			if (actionFilter) params.set("action", actionFilter);
			if (targetFilter.trim()) params.set("target", targetFilter.trim());
			response = await api.get<AuditLogResponse>(`/admin/audit-log?${params}`);
			page = p;
		} catch {
			response = null;
		} finally {
			loading = false;
		}
	}

	function metaSummary(meta: Record<string, unknown>): string {
		return Object.entries(meta)
			.map(([k, v]) => `${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
			.join(" · ");
	}

	load(1);
</script>

<svelte:head>
	<title>Audit log — Admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-3 flex-wrap">
		<h2 class="text-xl font-bold">Audit log</h2>
		{#if response}
			<span
				class="px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full"
				>{response.total} events</span
			>
		{/if}
		{#if loading}
			<div class="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
		{/if}
	</div>

	<p class="text-sm text-gray-500 dark:text-gray-400">
		Every mutating admin action — who did what to whom, when. Events are kept for two years.
	</p>

	<div class="flex items-end gap-3 flex-wrap">
		<label class="flex flex-col gap-1 text-xs text-gray-500">
			Admin
			<select
				bind:value={adminFilter}
				onchange={() => load(1)}
				class="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
			>
				<option value="">All</option>
				{#each response?.admins ?? [] as name (name)}
					<option value={name}>{name}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-gray-500">
			Action
			<select
				bind:value={actionFilter}
				onchange={() => load(1)}
				class="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5"
			>
				<option value="">All</option>
				{#each response?.actions ?? [] as action (action)}
					<option value={action}>{action}</option>
				{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-gray-500">
			Target id
			<input
				bind:value={targetFilter}
				onchange={() => load(1)}
				placeholder="user id, game id, page…"
				class="text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 w-56"
			/>
		</label>
		{#if adminFilter || actionFilter || targetFilter}
			<button
				class="px-3 py-1.5 text-sm font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg"
				onclick={() => {
					adminFilter = "";
					actionFilter = "";
					targetFilter = "";
					load(1);
				}}
			>
				Clear
			</button>
		{/if}
	</div>

	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		{#if response && response.logs.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
							<th class="px-5 py-2">When</th>
							<th class="px-5 py-2">Admin</th>
							<th class="px-5 py-2">Action</th>
							<th class="px-5 py-2">Target</th>
							<th class="px-5 py-2">Details</th>
						</tr>
					</thead>
					<tbody>
						{#each response.logs as log (log._id)}
							<tr class="border-b border-gray-50 dark:border-gray-800/50 align-top">
								<td class="px-5 py-2.5 text-gray-500 whitespace-nowrap" title={log.createdAt}>
									{timeAgo(log.createdAt)}
								</td>
								<td class="px-5 py-2.5 font-medium">{log.admin.name}</td>
								<td class="px-5 py-2.5">
									<code
										class="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 rounded"
										title="{log.method} {log.path}">{log.action}</code
									>
								</td>
								<td class="px-5 py-2.5">
									{#if log.target}
										<span class="text-xs text-gray-400">{log.target.kind}</span>
										<span title={log.target.id}>{log.target.label ?? log.target.id}</span>
									{:else}
										<span class="text-gray-400">—</span>
									{/if}
								</td>
								<td class="px-5 py-2.5 text-xs text-gray-500 max-w-md break-words">
									{log.meta ? metaSummary(log.meta) : "—"}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if pageCount > 1}
				<div
					class="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500"
				>
					<button
						class="px-3 py-1.5 font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50"
						disabled={page <= 1}
						onclick={() => load(page - 1)}
					>
						Previous
					</button>
					<span>Page {page} / {pageCount} · {response.total} events</span>
					<button
						class="px-3 py-1.5 font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50"
						disabled={page >= pageCount}
						onclick={() => load(page + 1)}
					>
						Next
					</button>
				</div>
			{/if}
		{:else if !loading}
			<p class="px-5 py-4 text-sm text-gray-500">
				No audit events{adminFilter || actionFilter || targetFilter ? " matching the filters" : " yet"}.
			</p>
		{/if}
	</div>
</div>
