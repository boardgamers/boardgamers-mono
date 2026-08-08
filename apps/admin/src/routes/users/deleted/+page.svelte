<script lang="ts">
	import { api } from "$lib/api.ts";
	import { timeAgo } from "$lib/utils.ts";

	interface DeletedUser {
		userId: string;
		account: { username: string; email?: string };
		createdAt?: string;
		deletedAt: string;
	}

	interface DeletedUsersResponse {
		users: DeletedUser[];
		total: number;
		page: number;
		limit: number;
	}

	let response = $state<DeletedUsersResponse | null>(null);
	let loading = $state(true);
	let page = $state(1);
	const limit = 20;

	const pageCount = $derived(Math.max(1, Math.ceil((response?.total ?? 0) / limit)));

	async function load(p: number) {
		loading = true;
		try {
			response = await api.get<DeletedUsersResponse>(`/admin/users/deleted?page=${p}&limit=${limit}`);
			page = p;
		} catch {
			response = null;
		} finally {
			loading = false;
		}
	}

	load(1);
</script>

<svelte:head>
	<title>Deleted users — Admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-3 flex-wrap">
		<h2 class="text-xl font-bold">Deleted users</h2>
		{#if response}
			<span
				class="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-full"
				>{response.total} archived</span
			>
		{/if}
		{#if loading}
			<div class="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
		{/if}
	</div>

	<p class="text-sm text-gray-500 dark:text-gray-400">
		Accounts archived by the dead-user cleanup (soft-delete). Restore is manual, via the database — see
		<code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">deletedUsers</code>.
	</p>

	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		{#if response && response.users.length > 0}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
							<th class="px-5 py-2">Username</th>
							<th class="px-5 py-2">Email</th>
							<th class="px-5 py-2">Joined</th>
							<th class="px-5 py-2">Deleted</th>
						</tr>
					</thead>
					<tbody>
						{#each response.users as user}
							<tr class="border-b border-gray-50 dark:border-gray-800/50">
								<td class="px-5 py-2.5 font-medium">
									{user.account.username}
									<span
										class="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded"
										>deleted</span
									>
								</td>
								<td class="px-5 py-2.5 text-gray-500">{user.account.email ?? "—"}</td>
								<td class="px-5 py-2.5 text-gray-500">{user.createdAt ? timeAgo(user.createdAt) : "—"}</td>
								<td class="px-5 py-2.5 text-gray-500" title={user.deletedAt}>{timeAgo(user.deletedAt)}</td>
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
					<span>Page {page} / {pageCount} · {response.total} archived</span>
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
			<p class="px-5 py-4 text-sm text-gray-500">No deleted users.</p>
		{/if}
	</div>
</div>
