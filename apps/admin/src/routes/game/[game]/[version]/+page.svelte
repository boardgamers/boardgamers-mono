<script lang="ts">
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { untrack } from "svelte";
	import { api, ApiError } from "$lib/api.ts";
	import { toast } from "$lib/toast.svelte.ts";
	import { loadGames } from "$lib/stores.svelte.ts";
	import GameEdit, { type GameInfoData } from "$components/GameEdit.svelte";
	import UserAutocomplete from "$components/UserAutocomplete.svelte";
	import WebLink from "$components/WebLink.svelte";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const gameId = $derived(data.value?._id?.game ?? "");
	const version = $derived(data.value?._id?.version ?? 0);
	// Beta grants only make sense while the latest version is not public.
	const showBeta = $derived(!!data.value && !data.value.public && version === data.latestVersion);
	const betaUsers = $derived(data.betaUsers);

	let inviteName = $state("");
	let inviting = $state(false);
	let removingBeta = $state<string | null>(null);
	let confirmRemoveBeta = $state<string | null>(null);

	async function inviteBeta() {
		const usernameOrEmail = inviteName.trim();
		if (!usernameOrEmail) return;
		inviting = true;
		try {
			await api.post(`/admin/gameinfo/${encodeURIComponent(gameId)}/beta-users`, { usernameOrEmail });
			toast.success(`Beta access granted to ${usernameOrEmail}`);
			inviteName = "";
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to invite");
		} finally {
			inviting = false;
		}
	}

	async function removeBetaUser(userId: string, username: string | null) {
		removingBeta = userId;
		try {
			await api.del(`/admin/gameinfo/${encodeURIComponent(gameId)}/beta-users/${userId}`);
			toast.success(`Beta access removed for ${username ?? userId}`);
			await invalidateAll();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to remove");
		} finally {
			removingBeta = null;
			confirmRemoveBeta = null;
		}
	}

	// Editable (bind:value into GameEdit); re-synced from load data by the $effect.
	// eslint-disable-next-line svelte/prefer-writable-derived -- GameEdit mutates `value` via bind:value; it is not purely derived from `data`.
	let value = $state<GameInfoData | null>(untrack(() => data.value));

	$effect(() => {
		value = data.value;
	});

	async function saveVersion(saveData: GameInfoData) {
		try {
			await api.put(`/admin/gameinfo/${gameId}/${version}`, saveData);
			toast.success("Version saved");
			await loadGames();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save");
		}
	}

	// The Game section edits the game-level fields on the merged `value`; the
	// metadata PUT takes just those fields (server-managed fields stripped).
	async function saveMetadata() {
		if (!value) return;
		try {
			const body = {
				label: value.label,
				alias: value.alias?.trim() || null,
				description: value.description,
				rules: value.rules,
				credits: value.credits,
				links: value.links,
				players: value.players,
				needOwnership: value.needOwnership,
				// Cleared checkbox → null: the API unsets the flag (listed again).
				unlisted: value.unlisted || null,
			};
			await api.put(`/admin/gameinfo/${encodeURIComponent(gameId)}/meta`, body);
			toast.success("Metadata saved");
			await loadGames();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to save metadata");
		}
	}

	async function duplicate() {
		if (!value) return;
		const newVersion = version + 1;
		try {
			const dup = { ...value, _id: { game: gameId, version: newVersion } };
			await api.post(`/admin/gameinfo/${gameId}/${newVersion}`, dup);
			toast.success(`Duplicated as v${newVersion}`);
			await loadGames();
			goto(resolve("/game/[game]/[version]", { game: gameId, version: String(newVersion) }));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to duplicate");
		}
	}

	async function remove() {
		if (!confirm(`Delete ${gameId} v${version}?`)) return;
		try {
			await api.del(`/admin/gameinfo/${gameId}/${version}`);
			toast.success("Deleted");
			await loadGames();
			goto(resolve("/"));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to delete");
		}
	}

	// Preconditions are enforced server-side. Archiving the latest public version
	// is a hard 409 (toast only); ongoing games are a soft 409 the admin can
	// confirm-and-proceed past by retrying with { force: true }.
	async function toggleArchive() {
		const archived = !!value?.meta?.archived;
		const action = archived ? "unarchive" : "archive";
		if (!confirm(`${archived ? "Unarchive" : "Archive"} ${gameId} v${version}?`)) return;
		try {
			await api.post(`/admin/gameinfo/${gameId}/${version}/${action}`);
		} catch (err) {
			// ApiError only carries message+status — the structured `error`/
			// `count` fields of the ongoing-games 409 are recovered from the
			// server message.
			const ongoing =
				err instanceof ApiError && err.status === 409 && !archived ? /(\d+) ongoing game/.exec(err.message) : null;
			if (ongoing) {
				if (!confirm(`There are still ${ongoing[1]} ongoing game(s) on this version. Archive anyway?`)) return;
				try {
					await api.post(`/admin/gameinfo/${gameId}/${version}/${action}`, { force: true });
				} catch (retryErr) {
					toast.error(retryErr instanceof Error ? retryErr.message : `Failed to ${action}`);
					return;
				}
			} else {
				toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
				return;
			}
		}
		toast.success(archived ? "Unarchived" : "Archived");
		await loadGames();
	}

	// Version-tab badge popover: which version's ongoing-games list is open, if
	// any. Absolutely positioned so it never grows the tab bar.
	let openPopover = $state<number | null>(null);

	function onPopoverKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			openPopover = null;
			(event.target as HTMLElement).blur();
		}
	}

	function onWindowClick(event: MouseEvent) {
		if (openPopover !== null && !(event.target as HTMLElement).closest(".ongoing-popover-anchor")) {
			openPopover = null;
		}
	}
</script>

<svelte:window onclick={onWindowClick} />

{#if value}
	<div class="space-y-8">
		<div class="flex items-center gap-4">
			<h2 class="text-xl font-bold">{value.label} <span class="text-gray-400 font-normal">({gameId})</span></h2>
			<div class="ml-auto text-sm">
				<WebLink path={`/boardgame/${gameId}`} />
			</div>
		</div>

		<!-- ===== Game metadata (shared by all versions) ===== -->
		<section class="space-y-4">
			<GameEdit mode="edit" bind:value sections="game" onsave={saveMetadata} />
		</section>

		<!-- ===== Private beta (only while the latest version is not public) ===== -->
		{#if showBeta}
			<section class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
				<div class="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-2">
					<h3 class="text-sm font-semibold">Private Beta ({betaUsers.length})</h3>
					<span class="text-xs text-gray-500">latest version v{data.latestVersion} is not public</span>
				</div>
				{#if betaUsers.length > 0}
					<div class="divide-y divide-gray-100 dark:divide-gray-800">
						{#each betaUsers as betaUser (betaUser.userId)}
							<div class="px-5 py-2.5 flex items-center gap-3 text-sm">
								{#if betaUser.username}
									<a
										href={resolve("/user/[username]", { username: betaUser.username })}
										class="font-medium text-blue-600 dark:text-blue-400 hover:underline"
									>
										{betaUser.username}
									</a>
								{:else}
									<span class="font-mono text-xs text-gray-500">{betaUser.userId} (deleted user)</span>
								{/if}
								<span class="text-xs text-gray-500">access up to v{betaUser.maxVersion}</span>
								<span class="ml-auto"></span>
								{#if confirmRemoveBeta === betaUser.userId}
									<button
										onclick={() => removeBetaUser(betaUser.userId, betaUser.username)}
										disabled={removingBeta === betaUser.userId}
										class="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
									>
										{removingBeta === betaUser.userId ? "Removing…" : "Confirm remove"}
									</button>
									<button
										onclick={() => (confirmRemoveBeta = null)}
										class="px-3 py-1 text-xs font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg"
									>
										Cancel
									</button>
								{:else}
									<button
										onclick={() => (confirmRemoveBeta = betaUser.userId)}
										class="px-3 py-1 text-xs font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-lg"
									>
										Remove
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="px-5 py-4 text-sm text-gray-500">No users in this beta yet.</p>
				{/if}
				<div class="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center gap-2">
					<UserAutocomplete bind:value={inviteName} class="w-64" onsubmit={inviteBeta} />
					<button
						onclick={inviteBeta}
						disabled={inviting || !inviteName.trim()}
						class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
					>
						{inviting ? "Inviting…" : "Invite"}
					</button>
					<span class="text-xs text-gray-400">grants access up to v{data.latestVersion}</span>
				</div>
			</section>
		{/if}

		<!-- ===== Versions (tabbed, latest first) ===== -->
		<section>
			<nav class="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800" aria-label="Versions">
				{#each data.versions as v (v.version)}
					{@const href = resolve("/game/[game]/[version]", { game: gameId, version: String(v.version) })}
					{@const active = v.version === version}
					{@const tabClass = `px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 ${
						active
							? "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 text-blue-600 dark:text-blue-400 -mb-px"
							: "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
					}`}
					{#if v.ongoing > 0}
						<!-- The badge is a button (click opens the game-links popover), so the tab
						     can't be a plain <a> around it — an <a> descendant of an <a> is invalid.
						     The "vX" text stays a link to the version tab. The popover is anchored
						     to the tab's left edge (left-0), not centered: tabs sit right next to
						     the sidebar, so a centered popover would slide under it and clip. -->
						<div class="ongoing-popover-anchor relative flex items-center {tabClass}">
							<a {href} class="hover:underline">v{v.version}</a>
							<button
								type="button"
								class="ml-1.5 px-1.5 py-px text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/70 cursor-pointer"
								title="{v.ongoing} ongoing game{v.ongoing === 1 ? '' : 's'} — click to list"
								aria-expanded={openPopover === v.version}
								onclick={() => (openPopover = openPopover === v.version ? null : v.version)}
								onkeydown={onPopoverKeydown}>{v.ongoing}</button
							>
							{#if v.archived}
								<span
									class="ml-1.5 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
									>archived</span
								>
							{/if}
							{#if openPopover === v.version}
								<div
									class="absolute left-0 top-full mt-1 z-20 min-w-44 max-w-64 max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg p-1.5 text-left font-normal normal-case tracking-normal"
									role="menu"
								>
									<div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
										Ongoing on v{v.version}
									</div>
									{#each v.ongoingGameIds as id (id)}
										<a
											href={resolve("/game/[gameId]", { gameId: id })}
											class="block px-2 py-1 text-xs font-mono rounded text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 truncate"
											role="menuitem">{id}</a
										>
									{/each}
									{#if v.ongoing > v.ongoingGameIds.length}
										<div class="px-2 py-1 text-[10px] text-gray-400">
											and {v.ongoing - v.ongoingGameIds.length} more
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{:else}
						<a {href} class={tabClass}>
							v{v.version}{#if v.archived}<span
									class="ml-1.5 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
									>archived</span
								>{/if}
						</a>
					{/if}
				{/each}
			</nav>

			<div class="pt-6 space-y-4">
				<div class="flex items-center gap-3">
					<h3 class="text-lg font-semibold">Version {version}</h3>
					{#if value.meta?.archived}
						<span
							class="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
						>
							Archived
						</span>
					{/if}
					<button
						onclick={toggleArchive}
						class="px-3 py-1.5 text-sm rounded-lg font-medium {value.meta?.archived
							? 'bg-gray-600 hover:bg-gray-700 text-white'
							: 'bg-amber-600 hover:bg-amber-700 text-white'}"
					>
						{value.meta?.archived ? "Unarchive" : "Archive"}
					</button>
				</div>

				<GameEdit
					mode="edit"
					bind:value
					sections="version"
					onsave={saveVersion}
					onduplicate={duplicate}
					ondelete={remove}
				/>
			</div>
		</section>
	</div>
{:else}
	<div class="flex items-center justify-center h-32">
		<div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{/if}
