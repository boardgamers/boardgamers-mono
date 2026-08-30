<script lang="ts">
	import { UserGames, UserElo, UserAvatar } from "@/components";
	import { Button, Card } from "@/modules/cdk";
	import { dateFromObjectId } from "@/utils";
	import { countryFlag, countryName } from "@/lib/countries";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import GameName from "@/components/GameName.svelte";
	import IconMeepleFill from "@/components/icons/IconMeepleFill.svelte";
	import type { PageProps } from "./$types";
	import { m, language } from "@/lib/i18n/messages";

	let { data }: PageProps = $props();
	let username = $derived(data.user.account.username);
	// The load function 404s if the user doesn't exist, so `_id` is always set here.
	let userId = $derived(data.user._id!);
	let joinDate = $derived(dateFromObjectId(userId));
	let likedGames = $derived(data.likedGames ?? []);
</script>

<div class="container mx-auto px-4">
	<div class="flex flex-col gap-2 md:flex-row">
		<div class="md:mr-2 md:w-64 md:min-w-64">
			<UserAvatar
				username={data.user.account.username}
				--avatar-border="1px solid gray"
				userId={data.user._id}
				size="8rem"
				class="mb-3"
			/>
			<h1 class="mb-2">{username}</h1>
			<div class="mb-2">
				☯️ <a href={resolve("/(app)/page/[part1]", { part1: "karma" })} title={m.user_karma()}
					>{data.user.account.karma}</a
				>
				{m.user_karma()} <br />
				{#if data.user.account.country}
					{countryFlag(data.user.account.country)}
					{countryName(data.user.account.country)} <br />
				{/if}
				{m.user_joined({
					month: joinDate.toLocaleString($language, { month: "long" }),
					year: joinDate.toLocaleString("default", { year: "numeric" }),
				})}
			</div>
			{#if data.user.account.bio}<p class="mt-2" title={m.user_bioTitle({ username: data.user.account.username })}>
					📝 {data.user.account.bio}
				</p>{/if}
			{#if data.isOwnProfile}
				<Button color="primary" href="/account" class="mt-2">{m.user_editProfile()}</Button>
				{#if !data.user.account.bio || !data.user.account.country}
					<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
						{#if !data.user.account.bio && !data.user.account.country}
							{m.user_emptyProfile()}
						{:else if !data.user.account.bio}
							{m.user_addBio()}
						{:else}
							{m.user_addCountry()}
						{/if}
					</p>
				{/if}
			{/if}
		</div>
		<div class="grow-[3]">
			<UserGames {userId} />

			{#if likedGames.length > 0}
				<Card class="border-gray-300 mt-4 dark:border-gray-600" header={m.user_likedGames()}>
					<ul class="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{#each likedGames as game (game.game)}
							<li>
								<a
									href={resolve("/(app)/boardgame/[boardgameId]", { boardgameId: game.game })}
									class="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 no-underline transition-shadow hover:border-primary hover:shadow-sm dark:border-gray-700 dark:hover:border-primary-lighter"
								>
									<!-- GameName renders the display name WITH its emoji (gameDisplayName) — no
									     separate gameBadge icon, or the emoji would show twice. -->
									<span class="min-w-0 flex-1 font-semibold">
										<GameName info={game} line />
									</span>
									<span
										class="flex shrink-0 items-center gap-1 text-sm text-gray-500 dark:text-gray-400"
										title={game.likeCount === 1
											? m.user_like({ count: game.likeCount })
											: m.user_like_plural({ count: game.likeCount })}
									>
										<IconMeepleFill size="0.85em" />
										{game.likeCount}
									</span>
								</a>
							</li>
						{/each}
					</ul>
				</Card>
			{/if}

			<Card class="border-gray-300 mt-4 dark:border-gray-600" header={m.user_statistics()}>
				<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<div class="mb-3">
						<UserElo userId={data.user._id!} />
					</div>
					<div>
						<h3 class="text-lg font-semibold">{m.user_tournaments()}</h3>
						<p>{m.user_noTournaments()}</p>
					</div>
				</div>
			</Card>
		</div>
	</div>
</div>
