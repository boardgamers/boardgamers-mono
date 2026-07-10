<script lang="ts">
	import { goto } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { page } from "$app/state";

	interface UserResult {
		_id: string;
		account: { username: string; email: string };
	}

	let query = $state("");
	let results: UserResult[] = $state([]);
	let searching = $state(false);
	let selected = $state(0);
	let debounceId: ReturnType<typeof setTimeout> | undefined;

	async function search() {
		clearTimeout(debounceId);
		debounceId = setTimeout(async () => {
			if (query.trim().length < 2) {
				results = [];
				return;
			}
			searching = true;
			selected = 0;
			try {
				results = await api.get(`/admin/users/search?search=${encodeURIComponent(query)}`);
			} catch {
				results = [];
			} finally {
				searching = false;
			}
		}, 200);
	}

	function select(username: string) {
		goto(`/user/${username}`);
	}

	function onkeydown(e: KeyboardEvent) {
		if (results.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			selected = Math.min(selected + 1, results.length - 1);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			selected = Math.max(selected - 1, 0);
		} else if (e.key === "Enter" && results[selected]) {
			e.preventDefault();
			select(results[selected].account.username);
		}
	}

	$effect(() => {
		// Reset selection when query changes
		query;
		selected = 0;
	});
</script>

<svelte:head>
	<title>Users — Admin</title>
</svelte:head>

<div class="max-w-2xl">
	<h2 class="text-xl font-bold mb-4">Users</h2>

	<div class="relative">
		<div class="relative">
			<svg
				class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
				/>
			</svg>
			<input
				bind:value={query}
				oninput={search}
				onkeydown={onkeydown}
				placeholder="Search by username or email..."
				class="w-full pl-10 pr-10 py-3 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				autocomplete="off"
			/>
			{#if searching}
				<div class="absolute right-3 top-1/2 -translate-y-1/2">
					<div class="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
				</div>
			{/if}
		</div>

		{#if results.length > 0}
			<div
				class="absolute z-10 mt-2 w-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-lg overflow-hidden"
			>
				{#each results as user, i}
					<button
						class="w-full px-4 py-3 text-left flex items-center gap-3 transition-colors {i === selected
							? 'bg-blue-50 dark:bg-blue-900/30'
							: 'hover:bg-gray-50 dark:hover:bg-gray-800'}"
						onclick={() => select(user.account.username)}
						onmouseenter={() => (selected = i)}
					>
						<div
							class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0"
						>
							{user.account.username.charAt(0).toUpperCase()}
						</div>
						<div class="min-w-0 flex-1">
							<div class="font-medium text-sm truncate">{user.account.username}</div>
							<div class="text-xs text-gray-500 truncate">{user.account.email}</div>
						</div>
						<svg
							class="w-4 h-4 text-gray-400 flex-shrink-0"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
						>
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
					</button>
				{/each}
			</div>
		{:else if query.length >= 2 && !searching}
			<p class="mt-3 text-sm text-gray-500">No users found.</p>
		{/if}
	</div>

	{#if query.length < 2}
		<p class="mt-6 text-sm text-gray-400">
			Search for users by username or email to view and manage their account.
		</p>
	{/if}
</div>
