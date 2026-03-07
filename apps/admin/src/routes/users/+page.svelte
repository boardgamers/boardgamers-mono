<script lang="ts">
	import { goto } from "$app/navigation";
	import { api } from "$lib/api.ts";

	let query = $state("");
	let results: { _id: string; account: { username: string; email: string } }[] = $state([]);
	let searching = $state(false);

	async function search() {
		if (query.trim().length < 2) return;
		searching = true;
		try {
			results = await api.get(`/admin/users/search?search=${encodeURIComponent(query)}`);
		} catch {
			results = [];
		} finally {
			searching = false;
		}
	}

	function select(username: string) {
		goto(`/user/${username}`);
	}
</script>

<div class="max-w-2xl">
	<h2 class="text-xl font-bold mb-4">Users</h2>

	<div class="relative">
		<input
			bind:value={query}
			oninput={search}
			placeholder="Search by username or email..."
			class="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
		/>
		{#if searching}
			<div class="absolute right-3 top-3">
				<div class="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
			</div>
		{/if}
	</div>

	{#if results.length > 0}
		<div
			class="mt-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden"
		>
			{#each results as user}
				<button
					class="w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between"
					onclick={() => select(user.account.username)}
				>
					<div>
						<div class="font-medium text-sm">{user.account.username}</div>
						<div class="text-xs text-gray-500">{user.account.email}</div>
					</div>
					<svg class="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"
						><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg
					>
				</button>
			{/each}
		</div>
	{:else if query.length >= 2 && !searching}
		<p class="mt-3 text-sm text-gray-500">No users found.</p>
	{/if}
</div>
