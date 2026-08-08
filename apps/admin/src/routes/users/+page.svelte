<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo } from "$lib/utils.ts";

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

	interface LoginMethods {
		recentDays: number;
		perMethod: { recent: Record<Method, number>; older: Record<Method, number> };
		combinations: { methods: Method[]; recent: number; older: number }[];
		sessions: Record<string, number>;
		trend: { weeks: number; methods: string[]; loginsByWeek: Record<string, string | number>[] };
	}
	type Method = "password" | "google" | "facebook" | "discord";
	const methodLabels: Record<Method, string> = {
		password: "Password",
		google: "Google",
		facebook: "Facebook",
		discord: "Discord",
	};

	const trendColor = (method: string) =>
		({
			password: "#3b82f6",
			google: "#ef4444",
			facebook: "#1877f2",
			discord: "#5865f2",
			admin: "#a855f7",
			unknown: "#9ca3af",
		})[method] ?? "#14b8a6";

	function linePath(values: number[], max: number, width: number, height: number): string {
		if (values.length === 0) return "";
		const pts = values.map((v, i) => [
			(i / Math.max(values.length - 1, 1)) * width,
			height - (v / Math.max(max, 1)) * height,
		]);
		return pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
	}

	let stats = $state<UserStats | null>(null);
	let loginMethods = $state<LoginMethods | null>(null);

	const trendMax = $derived(
		Math.max(1, ...(loginMethods?.trend.loginsByWeek ?? []).flatMap((w) => Object.values(w).slice(1).map(Number)))
	);
	const totalSessions = $derived(Object.values(loginMethods?.sessions ?? {}).reduce((acc, n) => acc + n, 0));

	const comboPageSize = 10;
	let comboFilter = $state<Method | "all">("all");
	let comboPage = $state(0);
	const filteredCombos = $derived(
		(loginMethods?.combinations ?? []).filter((c) => comboFilter === "all" || c.methods.includes(comboFilter))
	);
	const comboPageCount = $derived(Math.max(1, Math.ceil(filteredCombos.length / comboPageSize)));
	const pagedCombos = $derived(
		filteredCombos.slice(
			Math.min(comboPage, comboPageCount - 1) * comboPageSize,
			(Math.min(comboPage, comboPageCount - 1) + 1) * comboPageSize
		)
	);

	function toggleComboFilter(method: Method) {
		comboFilter = comboFilter === method ? "all" : method;
		comboPage = 0;
	}

	async function loadLoginMethods() {
		try {
			loginMethods = await api.get<LoginMethods>("/admin/users/login-methods");
		} catch {
			loginMethods = null;
		}
	}

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
		goto(resolve("/user/[username]", { username }));
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

	const maxCount = $derived(Math.max(1, ...(stats?.newUsersByDay ?? []).map((d) => d.count)));
	const confirmedPct = $derived(stats ? Math.round((stats.confirmedUsers / Math.max(stats.totalUsers, 1)) * 100) : 0);

	loadAdmins();
	loadStats();
	loadLoginMethods();
</script>

<svelte:head>
	<title>Users — Admin</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<h2 class="text-xl font-bold">Users</h2>
		<a href={resolve("/users/deleted")} class="text-sm text-blue-600 dark:text-blue-400 hover:underline"
			>Deleted users →</a
		>
	</div>

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
					<span class="inline-block w-2.5 h-2.5 rounded-full {stats.onlineUsers > 0 ? 'bg-green-500' : 'bg-gray-400'}"
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
					{#each stats.newUsersByDay as d (d.date)}
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

	<!-- Login methods -->
	{#if loginMethods}
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
			<h3 class="text-sm font-semibold mb-1">Login methods</h3>
			<p class="text-xs text-gray-400 mb-4">
				Users by login mechanism on their account — a user with several linked methods counts once per method in totals,
				once per combination below. Active = logged in within the last {loginMethods.recentDays} days. Click a method to filter
				the combinations table.
			</p>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
								<th class="py-2 pr-4">Method</th>
								<th class="py-2 pr-4 text-right">Active</th>
								<th class="py-2 text-right">Inactive / never</th>
							</tr>
						</thead>
						<tbody>
							{#each Object.keys(methodLabels) as method (method)}
								<tr
									class="border-b border-gray-50 dark:border-gray-800/50 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 {comboFilter ===
									method
										? 'bg-blue-50 dark:bg-blue-900/30'
										: ''}"
									onclick={() => toggleComboFilter(method as Method)}
								>
									<td class="py-2 pr-4 font-medium">{methodLabels[method as Method]}</td>
									<td class="py-2 pr-4 text-right">{loginMethods.perMethod.recent[method as Method]}</td>
									<td class="py-2 text-right text-gray-500">{loginMethods.perMethod.older[method as Method]}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div class="overflow-x-auto">
					<div class="flex flex-wrap gap-1.5 mb-3">
						<button
							class="px-2.5 py-1 text-xs font-medium rounded-full transition-colors {comboFilter === 'all'
								? 'bg-blue-600 text-white'
								: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
							onclick={() => (comboFilter = "all")}
						>
							All
						</button>
						{#each Object.keys(methodLabels) as method (method)}
							<button
								class="px-2.5 py-1 text-xs font-medium rounded-full transition-colors {comboFilter === method
									? 'bg-blue-600 text-white'
									: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}"
								onclick={() => toggleComboFilter(method as Method)}
							>
								{methodLabels[method as Method]}
							</button>
						{/each}
					</div>
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
								<th class="py-2 pr-4">Combination</th>
								<th class="py-2 pr-4 text-right">Active</th>
								<th class="py-2 text-right">Inactive / never</th>
							</tr>
						</thead>
						<tbody>
							{#each pagedCombos as combo (combo.methods.join("+"))}
								<tr class="border-b border-gray-50 dark:border-gray-800/50">
									<td class="py-2 pr-4 font-medium">
										{combo.methods.length ? combo.methods.map((m) => methodLabels[m]).join(" + ") : "None"}
									</td>
									<td class="py-2 pr-4 text-right">{combo.recent}</td>
									<td class="py-2 text-right text-gray-500">{combo.older}</td>
								</tr>
							{:else}
								<tr>
									<td colspan="3" class="py-4 text-sm text-gray-400">No combinations match this filter.</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if comboPageCount > 1}
						<div class="flex items-center justify-between mt-3 text-xs text-gray-500">
							<button
								class="px-3 py-1.5 font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50"
								disabled={comboPage === 0}
								onclick={() => (comboPage -= 1)}
							>
								Previous
							</button>
							<span>
								Page {Math.min(comboPage, comboPageCount - 1) + 1} / {comboPageCount} · {filteredCombos.length} combinations
							</span>
							<button
								class="px-3 py-1.5 font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg disabled:opacity-50"
								disabled={comboPage >= comboPageCount - 1}
								onclick={() => (comboPage += 1)}
							>
								Next
							</button>
						</div>
					{/if}
				</div>
			</div>

			<!-- Login trend (from refresh tokens stamped with the login method) -->
			<h4 class="text-sm font-semibold mt-6 mb-1">Logins per method — weekly, last {loginMethods.trend.weeks} weeks</h4>
			<p class="text-xs text-gray-400 mb-4">
				Actual logins, recorded on each new session. Pre-existing sessions have no recorded method and show up as
				"Unknown" until they expire (120-day token TTL).
			</p>
			{#if loginMethods.trend.loginsByWeek.length > 0 && loginMethods.trend.methods.length > 0}
				<svg viewBox="0 0 400 100" preserveAspectRatio="none" class="w-full h-40">
					{#each loginMethods.trend.methods as method (method)}
						<path
							d={linePath(
								loginMethods.trend.loginsByWeek.map((w) => Number(w[method])),
								trendMax,
								400,
								100
							)}
							fill="none"
							stroke={trendColor(method)}
							stroke-width="1.5"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
				</svg>
				<div class="flex justify-between mt-1 text-[10px] text-gray-400">
					<span>{loginMethods.trend.loginsByWeek[0]?.week ?? ""}</span>
					<span>{loginMethods.trend.loginsByWeek[loginMethods.trend.loginsByWeek.length - 1]?.week ?? ""}</span>
				</div>
				<div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
					{#each loginMethods.trend.methods as method (method)}
						<span class="flex items-center gap-1.5">
							<span class="inline-block w-2.5 h-2.5 rounded-full" style="background: {trendColor(method)}"></span>
							{methodLabels[method as Method] ?? method}
						</span>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-gray-400">No logins recorded yet.</p>
			{/if}

			<!-- Active sessions per mechanism (live refresh tokens, TTL-bounded) -->
			<h4 class="text-sm font-semibold mt-6 mb-4">Active sessions per mechanism</h4>
			<div class="overflow-x-auto md:w-1/2">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
							<th class="py-2 pr-4">Method</th>
							<th class="py-2 pr-4 text-right">Sessions</th>
							<th class="py-2 text-right">Share</th>
						</tr>
					</thead>
					<tbody>
						{#each Object.entries(loginMethods.sessions).sort((a, b) => b[1] - a[1]) as [method, count] (method)}
							<tr class="border-b border-gray-50 dark:border-gray-800/50">
								<td class="py-2 pr-4 font-medium">{methodLabels[method as Method] ?? method}</td>
								<td class="py-2 pr-4 text-right">{count}</td>
								<td class="py-2 text-right text-gray-500">
									{totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0}%
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
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
				{onkeydown}
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
				{#each results as user, i (user._id)}
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
						<svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
				{#each admins as admin (admin._id)}
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
								<span class="truncate"
									>seen {timeAgo(admin.security?.lastActive ?? admin.security?.lastLogin?.date)}</span
								>
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
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
			<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
				<h3 class="text-sm font-semibold">Search Results — Promote to Admin</h3>
			</div>
			<div class="divide-y divide-gray-100 dark:divide-gray-800">
				{#each results as user (user._id)}
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
