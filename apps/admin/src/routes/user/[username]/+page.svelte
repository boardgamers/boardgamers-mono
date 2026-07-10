<script lang="ts">
	import { page } from "$app/state";
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";

	interface UserInfo {
		_id: string;
		account: { username: string; email: string; karma: number };
		security?: { lastIp?: string; confirmed?: boolean };
	}

	interface ApiErrorItem {
		_id: string;
		error: { name: string; message: string };
		request: { url: string; method: string };
		createdAt: string;
		[key: string]: unknown;
	}

	let user: UserInfo | null = $state(null);
	let errors: ApiErrorItem[] = $state([]);
	let expandedError: string | null = $state(null);
	let gameName = $state("");
	let elo = $state(0);

	const username = $derived(page.params.username);

	$effect(() => {
		if (username) loadUser(username);
	});

	async function loadUser(name: string) {
		try {
			user = await api.get<UserInfo>(`/admin/users/infoByName/${name}`);
			errors = await api.get<ApiErrorItem[]>(`/admin/users/${user?._id}/api-errors`);
		} catch {
			toast.error("User not found");
		}
	}

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
			user.security = { ...user.security, confirmed: true };
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	async function loginAs() {
		if (!user) return;
		try {
			const data = await api.post<{ refreshToken: unknown }>("/admin/login-as", { username: user.account.username });
			const token = encodeURIComponent(JSON.stringify(data.refreshToken));
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
</script>

{#if user}
	<div class="max-w-4xl space-y-6">
		<div class="flex items-center gap-4">
			<h2 class="text-xl font-bold">{user.account.username}</h2>
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
		</div>

		<div class="text-sm text-gray-500 dark:text-gray-400 space-y-1">
			<p>Email: <span class="text-gray-900 dark:text-white">{user.account.email}</span></p>
			{#if user.security?.lastIp}
				<p>Last IP: <span class="text-gray-900 dark:text-white">{user.security.lastIp}</span></p>
			{/if}
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
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
