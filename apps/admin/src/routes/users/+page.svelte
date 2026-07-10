<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";

	interface UserResult {
		_id: string;
		account: { username: string; email: string };
		authority?: string;
		createdAt?: string;
	}

	interface AdminUser extends UserResult {
		security?: {
			lastOnline?: string;
			lastActive?: string;
			lastLogin?: { ip: string; date: string };
		};
		games: { total: number; active: number; ended: number };
	}

	interface UserStats {
		totalUsers: number;
		confirmedUsers: number;
		adminUsers: number;
		onlineUsers: number;
		connectedUsers: number;
		newUsersByDay: { date: string; count: number }[];
	}

	let query = $state("");
	let results: UserResult[] = $state([]);
	let searching = $state(false);
	let selected = $state(0);
	let debounceId: ReturnType<typeof setTimeout> | undefined;

	let admins: AdminUser[] = $state([]);
	let loadingAdmins = $state(true);
	let promoting = $state<string | null>(null);

	let stats = $state<UserStats | null>(null);

	async function loadAdmins() {
		loadingAdmins = true;
		try {
			admins = await api.get("/admin/users/admins");
		} catch {
			admins = [];
		} finally {
			loadingAdmins = false;
		}
	}

	async function loadStats() {
		try {
			stats = await api.get<UserStats>("/admin/users/stats");
		} catch {
			stats = null;
		}
	}

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

	async function promote(userId: string, username: string) {
		promoting = userId;
		try {
			await api.post(`/admin/users/${userId}/authority`, { authority: "admin" });
			toast.success(`${username} is now an admin`);
			await Promise.all([loadAdmins(), loadStats()]);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		} finally {
			promoting = null;
		}
	}

	async function demote(userId: string, username: string) {
		promoting = userId;
		try {
			await api.post(`/admin/users/${userId}/authority`, { authority: "user" });
			toast.success(`${username} is no longer an admin`);
			await Promise.all([loadAdmins(), loadStats()]);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		} finally {
			promoting = null;
		}
	}

	function timeAgo(iso?: string): string {
		if (!iso) return "never";
		const diff = Date.now() - new Date(iso).getTime();
		const sec = Math.floor(diff / 1000);
		if (sec < 60) return `${sec}s ago`;
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min}m ago`;
		const hr = Math.floor(min / 60);
		if (hr < 24) return `${hr}h ago`;
		const day = Math.floor(hr / 24);
		if (day < 30) return `${day}d ago`;
		const mon = Math.floor(day / 30);
		return `${mon}mo ago`;
	}

	const maxCount = $derived(Math.max(1, ...(stats?.newUsersByDay ?? []).map((d) => d.count)));
	const confirmedPct = $derived(
		stats ? Math.round((stats.confirmedUsers / Math.max(stats.totalUsers, 1)) * 100) : 0,
	);

	loadAdmins();
	loadStats();
</script>

<svelte:head>
	<title>Users — Admin</title>
</svelte:head>

<div class="space-y-6">
	<h2 class="text-xl font-bold">Users</h2>

	<!-- Metrics -->
	{#if stats}
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total</div>
				<div class="text-2xl font-bold mt-1">{stats.totalUsers.toLocaleString()}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Online</div>
				<div class="text-2xl font-bold mt-1 flex items-center gap-2">
					<span
						class="inline-block w-2.5 h-2.5 rounded-full {stats.onlineUsers > 0
							? 'bg-green-500'
							: 'bg-gray-400'}"
					></span>
					{stats.onlineUsers}
				</div>
				{#if stats.connectedUsers > stats.onlineUsers}
					<div class="text-xs text-gray-400 mt-0.5">{stats.connectedUsers} connected</div>
				{/if}
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Confirmed</div>
				<div class="text-2xl font-bold mt-1">{stats.confirmedUsers.toLocaleString()}</div>
				<div class="text-xs text-gray-400 mt-0.5">{confirmedPct}% of total</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Admins</div>
				<div class="text-2xl font-bold mt-1">{stats.adminUsers}</div>
			</div>
		</div>

		<!-- New users chart -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<h3 class="text-sm font-semibold mb-4">New users — last 30 days</h3>
			{#if stats.newUsersByDay.some((d) => d.count > 0)}
				<div class="flex items-end gap-[2px] h-32">
					{#each stats.newUsersByDay as d}
						<div
							class="flex-1 bg-blue-500 dark:bg-blue-400 rounded-t-sm hover:bg-blue-600 dark:hover:bg-blue-300 transition-colors relative group"
							style="height: {Math.max((d.count / maxCount) * 100, 2)}%"
						>
							<div
								class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
							>
								{d.date}: {d.count}
							</div>
						</div>
					{/each}
				</div>
				<div class="flex justify-between mt-2 text-[10px] text-gray-400">
					<span>{stats.newUsersByDay[0]?.date ?? ""}</span>
					<span>{stats.newUsersByDay[stats.newUsersByDay.length - 1]?.date ?? ""}</span>
				</div>
			{:else}
				<p class="text-sm text-gray-400">No new users in the last 30 days.</p>
			{/if}
		</div>
	{/if}

	<!-- Search -->
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
							<div class="font-medium text-sm truncate">
								{user.account.username}
								{#if user.authority === "admin"}
									<span
										class="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded"
										>admin</span
									>
								{/if}
							</div>
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
		<p class="text-sm text-gray-400">Search for users by username or email to view and manage their account.</p>
	{/if}

	<!-- Admins -->
	<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
		<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
			<h3 class="text-sm font-semibold">
				Admins
				<span class="text-gray-400 font-normal">({admins.length})</span>
			</h3>
			{#if loadingAdmins}
				<div class="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
			{/if}
		</div>
		{#if admins.length > 0}
			<div class="divide-y divide-gray-100 dark:divide-gray-800">
				{#each admins as admin}
					<div class="px-5 py-3 flex items-center gap-3">
						<div
							class="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-sm font-medium text-purple-600 dark:text-purple-400 flex-shrink-0"
						>
							{admin.account.username.charAt(0).toUpperCase()}
						</div>
						<div class="min-w-0 flex-1">
							<button
								onclick={() => select(admin.account.username)}
								class="font-medium text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
							>
								{admin.account.username}
							</button>
							<div class="flex items-center gap-2 text-xs text-gray-500">
								<span
									class="inline-block w-1.5 h-1.5 rounded-full {admin.security?.lastOnline &&
									Date.now() - new Date(admin.security.lastOnline).getTime() < 60000
										? 'bg-green-500'
										: 'bg-gray-400'}"
								></span>
								<span class="truncate">seen {timeAgo(admin.security?.lastActive ?? admin.security?.lastLogin?.date)}</span>
								{#if admin.games.total > 0}
									<span class="text-gray-400">· {admin.games.total} games</span>
								{/if}
							</div>
						</div>
						<button
							onclick={() => demote(admin._id, admin.account.username)}
							disabled={promoting === admin._id}
							class="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50 flex-shrink-0"
						>
							{promoting === admin._id ? "…" : "Demote"}
						</button>
					</div>
				{/each}
			</div>
		{:else if !loadingAdmins}
			<p class="px-5 py-4 text-sm text-gray-500">No admins found.</p>
		{/if}
	</div>

	<!-- Promote from search results -->
	{#if results.length > 0 && query.length >= 2}
		<div
			class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
		>
			<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
				<h3 class="text-sm font-semibold">Search Results — Promote to Admin</h3>
			</div>
			<div class="divide-y divide-gray-100 dark:divide-gray-800">
				{#each results as user}
					<div class="px-5 py-3 flex items-center gap-3">
						<div
							class="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-500 dark:text-gray-400 flex-shrink-0"
						>
							{user.account.username.charAt(0).toUpperCase()}
						</div>
						<div class="min-w-0 flex-1">
							<button
								onclick={() => select(user.account.username)}
								class="font-medium text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
							>
								{user.account.username}
							</button>
							<div class="text-xs text-gray-500 truncate">{user.account.email}</div>
						</div>
						{#if user.authority === "admin"}
							<span
								class="px-2 py-1 text-xs font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded flex-shrink-0"
								>Already admin</span
							>
						{:else}
							<button
								onclick={() => promote(user._id, user.account.username)}
								disabled={promoting === user._id}
								class="px-3 py-1.5 text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 flex-shrink-0"
							>
								{promoting === user._id ? "…" : "Promote"}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
