<script lang="ts">
	import UserAvatar from "./UserAvatar.svelte";
	import { countryFlag, countryName } from "@/lib/countries";
	import { useGameInfos, gameInfoKey } from "@/lib/game-info.svelte";
	import { getUserCardData, type UserCardData } from "@/lib/user-card.svelte";
	import { pluralize } from "@/utils";
	import { account } from "@/lib/account.svelte";

	let { username, userId = null }: { username: string; userId?: string | null } = $props();

	let data = $state<UserCardData | null | undefined>(undefined);

	$effect(() => {
		data = undefined;
		getUserCardData(username).promise.then((result) => {
			data = result;
		});
	});

	const gameInfos = useGameInfos();
	function gameName(game: string): string {
		return gameInfos[gameInfoKey(game, "latest")]?.label ?? game;
	}

	let eloRatings = $derived(
		(data?.elo ?? [])
			.filter((pref) => !!pref.elo)
			.sort((a, b) => (b.elo!.games ?? 0) - (a.elo!.games ?? 0))
			.slice(0, 3)
	);
	let isSelf = $derived(!!$account && data?.user?._id === $account._id);
</script>

{#if data === undefined}
	<div class="flex items-center gap-3 p-4">
		<div class="h-12 w-12 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
		<div class="flex-1 space-y-2">
			<div class="h-3 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-3 w-36 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
		</div>
	</div>
{:else if data === null}
	<div class="flex items-center gap-3 p-4">
		<UserAvatar {username} {userId} size="3rem" />
		<div class="min-w-0">
			<div class="truncate font-semibold">{username}</div>
			<a href={`/user/${encodeURIComponent(username)}`} class="text-sm text-primary hover:underline">View profile</a>
		</div>
	</div>
{:else}
	{@const user = data.user}
	<div class="p-4">
		<div class="flex items-start gap-3">
			<UserAvatar username={user.account.username} userId={user._id ?? userId} size="3rem" class="shrink-0" />
			<div class="min-w-0">
				<div class="truncate font-semibold">{user.account.username}</div>
				<div class="text-sm text-gray-500 dark:text-gray-400">
					☯️ {user.account.karma} karma
				</div>
				{#if user.account.country}
					<div class="text-sm text-gray-500 dark:text-gray-400">
						{countryFlag(user.account.country)}
						{countryName(user.account.country)}
					</div>
				{/if}
			</div>
		</div>
		{#if user.account.bio}
			<p class="mt-2 line-clamp-2 text-sm text-gray-700 dark:text-gray-300">{user.account.bio}</p>
		{/if}
		{#if eloRatings.length > 0}
			<div class="mt-2 flex flex-wrap gap-1">
				{#each eloRatings as pref}
					<span
						class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary dark:bg-primary/20 dark:text-primary-lighter"
					>
						{gameName(pref.game)} · <b>{pref.elo!.value}</b> in {pluralize(pref.elo!.games, "game")}
					</span>
				{/each}
			</div>
		{/if}
		<div class="mt-3 flex items-center justify-between border-t border-gray-200 pt-2 dark:border-gray-700">
			<a href={`/user/${encodeURIComponent(username)}`} class="text-sm text-primary hover:underline">
				View profile →
			</a>
			{#if isSelf}
				<a href="/account" class="text-sm text-gray-500 hover:underline dark:text-gray-400">Edit profile</a>
			{/if}
		</div>
	</div>
{/if}
