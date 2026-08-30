<script lang="ts">
	import { api } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { timeAgo, webHost } from "$lib/utils.ts";
	import { trim } from "$lib/actions.ts";
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import WebLink from "$components/WebLink.svelte";
	import { ADMIN_PERMISSIONS, PERMISSION_LABELS, PERMISSION_NOTES, type AdminPermission } from "$lib/permissions.ts";
	import type { UserFront, ChatMuteDuration } from "@bgs/models";
	import type { PageProps } from "./$types";
	import type { UserInfo, ArchivedUserInfo, ApiErrorItem, BetaAccess } from "./+page.ts";

	let { data }: PageProps = $props();

	const user = $derived<UserInfo | null>(data.user);
	const archived = $derived<ArchivedUserInfo | null>(data.archived);
	const errors = $derived<ApiErrorItem[]>(data.errors);
	const betas = $derived<BetaAccess[]>(data.betas);
	let removingBeta = $state<string | null>(null);
	let confirmRemoveBeta = $state<string | null>(null);

	async function removeBeta(game: string) {
		if (!user) return;
		removingBeta = game;
		try {
			await api.del(`/admin/users/${user._id}/access/${encodeURIComponent(game)}`);
			toast.success(`Beta access to ${game} removed`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		} finally {
			removingBeta = null;
			confirmRemoveBeta = null;
		}
	}
	let expandedError = $state<string | null>(null);
	let gameName = $state("");
	let elo = $state(0);

	// gameName is trimmed on paste/blur by the use:trim action.
	async function grantAccess() {
		const game = gameName;
		if (!game || !user) return;
		try {
			await api.post(`/admin/users/${user._id}/access/grant`, { type: "game", game, version: "latest" });
			toast.success(`Access granted to ${game}`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		}
	}

	async function changeElo() {
		const game = gameName;
		if (!game || !user) return;
		try {
			await api.post(`/admin/users/${user._id}/elo/${encodeURIComponent(game)}`, { value: elo });
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
			// The session cookie is host-only (#153), so it can't travel across subdomains:
			// hand the one-time code to the web app's /login, which exchanges it server-side
			// (POST /account/session) for a session cookie on the player-facing host.
			// URLSearchParams encodes once — an encodeURIComponent here would double-encode
			// (searchParams.get already decodes) and corrupt codes containing %.
			const target = new URL(`${webHost()}/login`, location.origin);
			target.searchParams.set("refreshToken", JSON.stringify(res.refreshToken));
			location.href = target.href;
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
			if (newAuthority === "user") {
				user.adminGrants = undefined;
			}
			toast.success(newAuthority === "admin" ? "Promoted to admin" : "Demoted to user");
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		} finally {
			togglingAdmin = false;
		}
	}

	// --- Granular permissions (scoped admin) ---
	const scopedGrants = $derived(user?.authority === "admin" ? [] : (user?.adminGrants ?? []));
	const gameGrants = $derived(
		scopedGrants.filter((g) => g.startsWith("gameinfo:")).map((g) => g.slice("gameinfo:".length))
	);
	let savingGrants = $state(false);
	let gameGrantInput = $state("");

	async function saveGrants(grants: string[], successMessage: string) {
		if (!user) return;
		savingGrants = true;
		try {
			await api.put(`/admin/users/${user._id}/grants`, { adminGrants: grants });
			user.adminGrants = grants.length > 0 ? grants : undefined;
			toast.success(successMessage);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
		} finally {
			savingGrants = false;
		}
	}

	const hasGrant = (permission: AdminPermission) => scopedGrants.includes(permission);

	async function toggleGrant(permission: AdminPermission) {
		const grants = scopedGrants.filter((g) => !g.startsWith("gameinfo:"));
		const next = hasGrant(permission) ? grants.filter((g) => g !== permission) : [...grants, permission];
		await saveGrants([...next, ...scopedGrants.filter((g) => g.startsWith("gameinfo:"))], "Permissions updated");
	}

	async function addGameGrant() {
		const game = gameGrantInput.trim();
		if (!game || !user) return;
		if (gameGrants.includes(game)) {
			toast.error(`${game} is already granted`);
			return;
		}
		gameGrantInput = "";
		await saveGrants([...scopedGrants, `gameinfo:${game}`], `Boardgame admin granted for ${game}`);
	}

	async function removeGameGrant(game: string) {
		await saveGrants(
			scopedGrants.filter((g) => g !== `gameinfo:${game}`),
			`Boardgame admin revoked for ${game}`
		);
	}

	let showRevokeConfirm = $state(false);
	let revoking = $state(false);

	async function revokeSessions() {
		if (!user) return;
		revoking = true;
		try {
			const res = await api.del<{ deleted: number }>(`/admin/users/${user._id}/refresh-tokens`);
			toast.success(
				`Sessions revoked (${res.deleted} refresh token${res.deleted === 1 ? "" : "s"} deleted) — all devices logged out`
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to revoke sessions");
		} finally {
			revoking = false;
			showRevokeConfirm = false;
		}
	}

	// Mirrors the api's CHAT_MUTE_DURATIONS keys (value import of @bgs/models/user
	// would pull mongodb into the bundle — labels are admin-UI-only anyway).
	const CHAT_MUTE_OPTIONS: { duration: ChatMuteDuration; label: string }[] = [
		{ duration: "1h", label: "1 hour" },
		{ duration: "1d", label: "1 day" },
		{ duration: "7d", label: "7 days" },
		{ duration: "permanent", label: "Permanent" },
	];
	let mutingChat = $state(false);
	const chatMutedUntil = $derived(user?.chatMutedUntil ? new Date(user.chatMutedUntil) : null);
	const chatMuted = $derived(!!chatMutedUntil && chatMutedUntil.getTime() > Date.now());
	// A "permanent" mute is a far-future date (100 years) — display it as such.
	const chatMutePermanent = $derived(
		!!chatMutedUntil && chatMutedUntil.getTime() - Date.now() > 50 * 365 * 24 * 3600 * 1000
	);

	async function muteChat(duration: ChatMuteDuration) {
		if (!user) return;
		mutingChat = true;
		try {
			await api.post(`/admin/users/${user._id}/chat-mute`, { duration });
			toast.success(`${user.account.username} muted from chat (${duration})`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to mute");
		} finally {
			mutingChat = false;
		}
	}

	async function unmuteChat() {
		if (!user) return;
		mutingChat = true;
		try {
			await api.del(`/admin/users/${user._id}/chat-mute`);
			toast.success(`${user.account.username} unmuted`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to unmute");
		} finally {
			mutingChat = false;
		}
	}

	async function deleteUser() {
		if (!user) return;
		deleting = true;
		try {
			await api.del(`/admin/users/${user._id}`);
			toast.success("User deleted");
			goto(resolve("/users"));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete user");
		} finally {
			deleting = false;
			showDeleteConfirm = false;
		}
	}

	const providerLabel: Record<string, string> = {
		google: "Google",
		discord: "Discord",
		facebook: "Facebook",
		github: "GitHub",
		huggingface: "Hugging Face",
	};

	const socialLinks = $derived(
		user?.account.social
			? Object.entries(user.account.social)
					.filter(([, id]) => !!id)
					.map(([provider]) => {
						const meta = user?.account.socialMeta?.[provider as keyof NonNullable<UserFront["account"]["socialMeta"]>];
						return {
							provider,
							label: providerLabel[provider] ?? provider,
							username: meta?.username,
							url: meta?.url,
						};
					})
			: []
	);

	const totalGames = $derived(user?.games ? Object.values(user.games).reduce((a, b) => a + (b ?? 0), 0) : 0);
	const isOnline = $derived(
		user?.security?.lastOnline && Date.now() - new Date(user.security.lastOnline).getTime() < 60000
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
				{#if scopedGrants.length > 0}
					<span
						class="px-2 py-0.5 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-full"
						>Scoped admin</span
					>
				{/if}
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
			<div class="ml-auto text-sm">
				<WebLink path={`/user/${user.account.username}`} />
			</div>
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

		<!-- Social Accounts (read-only, non-sensitive display info) -->
		{#if socialLinks.length > 0}
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-2">
				<h3 class="text-sm font-semibold">Social Accounts</h3>
				<div class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
					{#each socialLinks as link (link.provider)}
						<div>
							<span class="text-gray-500 dark:text-gray-400">{link.label}:</span>
							{#if link.url}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- external social-profile URL, not an app route -->
								<a
									href={link.url}
									target="_blank"
									rel="noopener noreferrer"
									class="ml-1 text-blue-600 dark:text-blue-400 hover:underline"
									>{link.username ? `@${link.username}` : link.url} ↗</a
								>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{:else}
								<span class="ml-1">{link.username ? `@${link.username}` : "linked"}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Admin Permissions -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
			<div class="flex items-center gap-2">
				<h3 class="text-sm font-semibold">Admin Permissions</h3>
				{#if user.authority === "admin"}
					<span class="text-xs text-gray-400">— full admin, holds every permission</span>
				{/if}
			</div>
			{#if user.authority !== "admin"}
				<div class="flex flex-wrap gap-x-5 gap-y-2">
					{#each ADMIN_PERMISSIONS as permission (permission)}
						<label class="flex items-center gap-1.5 text-sm cursor-pointer">
							<input
								type="checkbox"
								checked={hasGrant(permission)}
								disabled={savingGrants}
								onchange={() => toggleGrant(permission)}
								class="rounded border-gray-300 dark:border-gray-700 text-purple-600 focus:ring-purple-500"
							/>
							{PERMISSION_LABELS[permission]}
							{#if PERMISSION_NOTES[permission]}
								<span class="text-xs text-amber-600 dark:text-amber-400" title={PERMISSION_NOTES[permission]}>⚠</span>
							{/if}
						</label>
					{/each}
				</div>
				<div class="space-y-2">
					<div class="text-xs font-medium text-gray-500 uppercase tracking-wide">Boardgame admin</div>
					{#if gameGrants.length > 0}
						<div class="flex flex-wrap gap-2">
							{#each gameGrants as game (game)}
								<span
									class="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-lg"
								>
									{game}
									<button
										onclick={() => removeGameGrant(game)}
										disabled={savingGrants}
										class="text-indigo-500 hover:text-indigo-800 dark:hover:text-indigo-100 disabled:opacity-50"
										title="Revoke"
										aria-label={`Revoke boardgame admin for ${game}`}>✕</button
									>
								</span>
							{/each}
						</div>
					{:else}
						<p class="text-xs text-gray-400">
							Manages only the listed boardgames (info, versions, private beta, games).
						</p>
					{/if}
					<div class="flex gap-2">
						<input
							bind:value={gameGrantInput}
							use:trim
							placeholder="Boardgame id (e.g. gaia-project)"
							class="w-64 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
							onkeydown={(e) => e.key === "Enter" && addGameGrant()}
						/>
						<button
							onclick={addGameGrant}
							disabled={savingGrants || !gameGrantInput.trim()}
							class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
						>
							Grant
						</button>
					</div>
				</div>
			{:else}
				<div class="flex flex-wrap gap-2">
					{#each ADMIN_PERMISSIONS as permission (permission)}
						<span
							class="px-2 py-1 text-xs font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-lg"
							>{PERMISSION_LABELS[permission]}</span
						>
					{/each}
					<span
						class="px-2 py-1 text-xs font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-lg"
						>Every boardgame</span
					>
				</div>
			{/if}
		</div>

		<!-- User Management -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">User Management</h3>
			<div class="flex items-center gap-3">
				<label class="text-sm text-gray-500 flex items-center gap-3"
					>Karma
					<input
						type="number"
						bind:value={user.account.karma}
						class="w-24 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</label>
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
				{#if !showRevokeConfirm}
					<button
						onclick={() => (showRevokeConfirm = true)}
						class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium"
					>
						Clear sessions
					</button>
				{:else}
					<button
						onclick={revokeSessions}
						disabled={revoking}
						class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
					>
						{revoking ? "Revoking…" : "Revoke all sessions?"}
					</button>
					<button
						onclick={() => (showRevokeConfirm = false)}
						class="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium"
					>
						Cancel
					</button>
				{/if}
			</div>
			<!-- Chat mute (moderation): posting/editing/reacting 403s in every chat while muted -->
			<div class="pt-3 border-t border-gray-200 dark:border-gray-800 space-y-2">
				<div class="flex items-center gap-2 text-sm">
					<span class="font-medium">Chat mute</span>
					{#if chatMuted}
						<span
							class="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
						>
							{chatMutePermanent ? "Muted permanently" : `Muted until ${chatMutedUntil?.toLocaleString()}`}
						</span>
					{:else}
						<span class="text-gray-500 dark:text-gray-400">Not muted</span>
					{/if}
				</div>
				<div class="flex flex-wrap gap-2">
					{#each CHAT_MUTE_OPTIONS as { duration, label } (duration)}
						<button
							onclick={() => muteChat(duration)}
							disabled={mutingChat}
							class="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
						>
							Mute {label.toLowerCase()}
						</button>
					{/each}
					{#if chatMuted}
						<button
							onclick={unmuteChat}
							disabled={mutingChat}
							class="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
						>
							Unmute
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Private Betas -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
			<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800">
				<h3 class="text-sm font-semibold">Private Betas ({betas.length})</h3>
			</div>
			{#if betas.length > 0}
				<div class="divide-y divide-gray-100 dark:divide-gray-800">
					{#each betas as beta (beta.game)}
						<div class="px-5 py-2.5 flex items-center gap-3 text-sm">
							<a
								href={resolve("/game/[game]/[version]", { game: beta.game, version: String(beta.maxVersion) })}
								class="font-medium text-blue-600 dark:text-blue-400 hover:underline"
							>
								{beta.label}
							</a>
							<span class="text-xs text-gray-500">access up to v{beta.maxVersion}</span>
							<span class="ml-auto"></span>
							{#if confirmRemoveBeta === beta.game}
								<button
									onclick={() => removeBeta(beta.game)}
									disabled={removingBeta === beta.game}
									class="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
								>
									{removingBeta === beta.game ? "Removing…" : "Confirm remove"}
								</button>
								<button
									onclick={() => (confirmRemoveBeta = null)}
									class="px-3 py-1 text-xs font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg"
								>
									Cancel
								</button>
							{:else}
								<button
									onclick={() => (confirmRemoveBeta = beta.game)}
									class="px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg"
								>
									Remove
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="px-5 py-4 text-sm text-gray-500">No private beta access.</p>
			{/if}
		</div>

		<!-- Boardgame Management -->
		<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-3">
			<h3 class="text-sm font-semibold">Boardgame Management</h3>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1"
						>Boardgame name
						<input
							bind:value={gameName}
							use:trim
							class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
					</label>
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1"
						>Elo
						<input
							type="number"
							bind:value={elo}
							class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
					</label>
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
					{#each user.recentGames as game (game._id)}
						<a
							href={resolve("/game/[gameId]", { gameId: game._id })}
							class="px-5 py-2.5 flex items-center justify-between text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50"
						>
							<span class="font-mono text-xs truncate flex-1">{game._id}</span>
							<span class="text-xs text-gray-500 ml-3 flex-shrink-0">{game.game.name}</span>
							<span
								class="ml-3 px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0 {game.status === 'active'
									? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
									: game.status === 'ended'
										? 'bg-gray-100 dark:bg-gray-800 text-gray-500'
										: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'}"
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
							{#each errors as err (err._id)}
								<tr
									class="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
									onclick={() => toggleError(String(err._id))}
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
													2
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
						Are you sure? This will delete the user, refresh tokens, game preferences, notifications, room metadata, and
						API error records. This cannot be undone.
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
{:else if archived}
	<div class="space-y-6">
		<div class="flex items-center gap-4 flex-wrap">
			<h2 class="text-xl font-bold">{archived.account.username}</h2>
			<span
				class="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-full"
				>Deleted (archived)</span
			>
		</div>

		<div
			class="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 p-5 flex items-center gap-3"
		>
			<svg
				class="w-5 h-5 text-red-500 flex-shrink-0"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
				/>
			</svg>
			<p class="text-sm text-red-700 dark:text-red-300">
				This account was archived by the dead-user cleanup. Its data was moved to
				<code class="text-xs bg-red-100 dark:bg-red-900/40 px-1 py-0.5 rounded">deletedUsers</code>
				— restore is manual via the database.
			</p>
		</div>

		<div class="grid grid-cols-2 md:grid-cols-3 gap-4">
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Username</div>
				<div class="text-sm font-medium mt-1 truncate">{archived.account.username}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Joined</div>
				<div class="text-sm font-medium mt-1">{archived.createdAt ? timeAgo(archived.createdAt) : "—"}</div>
			</div>
			<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-red-800 p-4">
				<div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Deleted</div>
				<div class="text-sm font-medium mt-1 text-red-600 dark:text-red-400" title={archived.deletedAt}>
					{timeAgo(archived.deletedAt)}
				</div>
			</div>
		</div>

		<a href={resolve("/users/deleted")} class="inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline">
			← All deleted users
		</a>
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
