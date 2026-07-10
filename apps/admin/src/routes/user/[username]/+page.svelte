<script lang="ts">
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { goto, invalidateAll } from "$app/navigation";
	import type { UserInfo, ApiErrorItem, RecentGame } from "./+page.ts";

	let { data }: { data: { user: UserInfo | null; errors: ApiErrorItem[] } } = $props();

	let user = $state<UserInfo | null>(data.user);
	let errors = $state<ApiErrorItem[]>(data.errors);
	let expandedError = $state<string | null>(null);
	let gameName = $state("");
	let elo = $state(0);

	$effect(() => {
		user = data.user;
		errors = data.errors;
	});

	async function grantAccess() {
		if (!gameName.trim() || !user) return;
		try {
			await api.post(`/admin/users/${user._id}/access/grant`, { type: "game", game: gameName, version: "latest" });
			toast.success(`Access granted to ${gameName}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	async function changeElo() {
		if (!gameName.trim() || !user) return;
		try {
			await api.post(`/admin/users/${user._id}/elo/${gameName}`, { value: elo });
			toast.success("Elo changed");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	async function confirmUser() {
		if (!user) return;
		try {
			await api.post(`/admin/users/${user._id}/confirm`, {});
			toast.success("User confirmed");
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	async function loginAs() {
		if (!user) return;
		try {
			const res = await api.post<{ refreshToken: unknown }>("/admin/login-as", { username: user.account.username });
			const token = encodeURIComponent(JSON.stringify(res.refreshToken));
			if (location.hostname === "localhost") {
				location.href = `http://localhost:8615/login?refreshToken=${token}`;
			} else {
				location.href = `//${location.hostname.slice("admin.".length)}/login?refreshToken=${token}`;
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	async function updateKarma() {
		if (!user) return;
		try {
			await api.post(`/admin/users/${user._id}`, { account: { karma: user.account.karma } });
			toast.success(`Karma updated to ${user.account.karma}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	function toggleError(id: string) {
		expandedError = expandedError === id ? null : id;
	}

	let showDeleteConfirm = $state(false);
	let deleting = $state(false);
	let togglingAdmin = $state(false);

	async function toggleAdmin() {
		if (!user) return;
		togglingAdmin = true;
		const newAuthority = user.authority === "admin" ? "user" : "admin";
		try {
			await api.post(`/admin/users/${user._id}/authority`, { authority: newAuthority });
			user.authority = newAuthority;
			toast.success(newAuthority === "admin" ? "Promoted to admin" : "Demoted to user");
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		} finally {
			togglingAdmin = false;
		}
	}

	async function deleteUser() {
		if (!user) return;
		deleting = true;
		try {
			await api.del(`/admin/users/${user._id}`);
			toast.success("User deleted");
			goto("/users");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete user");
		} finally {
			deleting = false;
			showDeleteConfirm = false;
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

	const totalGames = $derived(
		user?.games ? Object.values(user.games).reduce((a, b) => a + (b ?? 0), 0) : 0,
	);
	const isOnline = $derived(
		user?.security?.lastOnline && Date.now() - new Date(user.security.lastOnline).getTime() < 60000,
	);
</script>

{#if user}
	<div class="space-y-6">
		<div class="flex items-center gap-4 flex-wrap">
				<h2 class="text-xl font-bold">{user.account.username}</h2>
				{#if user.authority === "admin"}
					<span
						class="px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-full"
						>Admin</span
					>
				{:else}
					<button
						onclick={toggleAdmin}
						disabled={togglingAdmin}
						class="px-3 py-1 text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-full disabled:opacity-50"
					>
						{togglingAdmin ? "…" : "Promote to admin"}
					</button>
				{/if}
				{#if user.security?.confirmed}
					<span
						class="px-2 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-full"
						>Confirmed</span
					>
				{:else}
					<button
						onclick={confirmUser}
						class="px-3 py-1 text-xs font-medium bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded-full hover:opacity-80"
					>
						Confirm user
					</button>
				{/if}
				{#if user.authority === "admin"}
					<button
						onclick={toggleAdmin}
						disabled={togglingAdmin}
						class="px-3 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full disabled:opacity-50"
					>
						{togglingAdmin ? "…" : "Demote to user"}
					</button>
				{/if}
			</div>

		<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
				<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
					<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Status</div>
					<div class="text-sm font-medium mt-1 flex items-center gap-1.5">
						<span class="inline-block w-2 h-2 rounded-full {isOnline ? 'bg-green-500' : 'bg-gray-400'}"></span>
						{isOnline ? "Online" : "Offline"}
					</div>
				</div>
				<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
					<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Last Active</div>
					<div class="text-sm font-medium mt-1">{timeAgo(user.security?.lastActive)}</div>
				</div>
				<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
					<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Last Login</div>
					<div class="text-sm font-medium mt-1">{timeAgo(user.security?.lastLogin?.date)}</div>
					{#if user.security?.lastLogin?.ip}
						<div class="text-xs text-gray-400 mt-0.5">{user.security.lastLogin.ip}</div>
					{/if}
				</div>
				<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
					<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Joined</div>
					<div class="text-sm font-medium mt-1">{timeAgo(user.createdAt)}</div>
				</div>
				<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
					<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Games</div>
					<div class="text-sm font-medium mt-1">{totalGames}</div>
					{#if user.games}
						<div class="flex gap-2 text-xs text-gray-400 mt-0.5">
							{#if user.games.active}<span class="text-amber-500">{user.games.active} active</span>{/if}
							{#if user.games.ended}<span class="text-gray-400">{user.games.ended} ended</span>{/if}
							{#if user.games.open}<span class="text-blue-500">{user.games.open} open</span>{/if}
						</div>
					{/if}
				</div>
				<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
					<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Email</div>
					<div class="text-sm font-medium mt-1 truncate">{user.account.email}</div>
					{#if user.security?.lastIp}
						<div class="text-xs text-gray-400 mt-0.5">IP: {user.security.lastIp}</div>
					{/if}
				</div>
			</div>

		<!-- User Management -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">User Management</h3>
			<div class="flex items-center gap-3">
				<label class="text-sm text-gray-500">Karma</label>
				<input
					type="number"
					bind:value={user.account.karma}
					class="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
				<button
					onclick={updateKarma}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">Update</button
				>
			</div>
			<div class="flex gap-2">
				<button
					onclick={loginAs}
					class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium"
				>
					Log in as
				</button>
			</div>
		</div>

		<!-- Boardgame Management -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Boardgame Management</h3>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1">Boardgame name</label>
					<input
						bind:value={gameName}
						class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1">Elo</label>
					<input
						type="number"
						bind:value={elo}
						class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
			</div>
			<div class="flex gap-2">
				<button
					onclick={grantAccess}
					class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
				>
					Grant access
				</button>
				<button
					onclick={changeElo}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
				>
					Change elo
				</button>
			</div>
		</div>

			<!-- Recent Games -->
			{#if user.recentGames && user.recentGames.length > 0}
				<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
					<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
						<h3 class="text-sm font-semibold">Recent Games ({user.recentGames.length})</h3>
					</div>
					<div class="divide-y divide-gray-100 dark:divide-gray-800">
						{#each user.recentGames as game}
							<a
								href={`/game/${game._id}`}
								class="px-5 py-2.5 flex items-center justify-between text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
							>
								<span class="font-mono text-xs truncate flex-1">{game._id}</span>
								<span class="text-xs text-gray-500 ml-3 flex-shrink-0">{game.game.name}</span>
								<span
									class="ml-3 px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0 {game.status ===
									"active"
										? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
										: game.status === "ended"
											? "bg-gray-100 dark:bg-gray-800 text-gray-500"
											: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"}"
								>
									{game.status}
								</span>
								<span class="ml-3 text-xs text-gray-400 flex-shrink-0 w-16 text-right">{timeAgo(game.lastMove)}</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- API Errors -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
			<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
				<h3 class="text-sm font-semibold">API Errors ({errors.length})</h3>
			</div>
			{#if errors.length > 0}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-100 dark:border-gray-800 text-left text-xs text-gray-500 uppercase">
								<th class="px-4 py-2 w-8"></th>
								<th class="px-4 py-2">Name</th>
								<th class="px-4 py-2">Method</th>
								<th class="px-4 py-2">URL</th>
							</tr>
						</thead>
						<tbody>
							{#each errors as err}
								<tr
									class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
									onclick={() => toggleError(err._id)}
								>
									<td class="px-4 py-2 text-gray-400">
										<svg
											class="w-4 h-4 transition-transform {expandedError === err._id ? 'rotate-90' : ''}"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg
										>
									</td>
									<td class="px-4 py-2 text-red-600 dark:text-red-400">{err.error.name}</td>
									<td class="px-4 py-2 font-mono text-xs">{err.request.method}</td>
									<td class="px-4 py-2 font-mono text-xs truncate max-w-[300px]">{err.request.url}</td>
								</tr>
								{#if expandedError === err._id}
									<tr>
										<td colspan="4" class="px-4 py-3 bg-gray-50 dark:bg-gray-950">
											<pre
												class="text-xs font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto">{JSON.stringify(
													err,
													null,
													2,
												).replaceAll("\\n", "\n")}</pre>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
					<p class="px-5 py-4 text-sm text-gray-500">No API errors.</p>
					{/if}
				</div>

				<!-- Danger zone -->
				<div class="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 p-5">
					<h3 class="text-sm font-semibold text-red-700 dark:text-red-400">Danger Zone</h3>
					{#if !showDeleteConfirm}
						<div class="flex items-center justify-between mt-2">
							<p class="text-sm text-red-600 dark:text-red-500/80">Permanently delete this user and all associated data.</p>
							<button
								onclick={() => (showDeleteConfirm = true)}
								class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium flex-shrink-0"
							>
								Delete user
							</button>
						</div>
					{:else}
						<div class="mt-2 space-y-3">
							<p class="text-sm text-red-700 dark:text-red-400">
								Are you sure? This will delete the user, refresh tokens, game preferences, notifications, room metadata, and API error records. This cannot be undone.
							</p>
							<div class="flex gap-2">
								<button
									onclick={deleteUser}
									disabled={deleting}
									class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
								>
									{deleting ? "Deleting…" : "Yes, delete permanently"}
								</button>
								<button
									onclick={() => (showDeleteConfirm = false)}
									class="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
								>
									Cancel
								</button>
							</div>
						</div>
					{/if}
				</div>
			</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
