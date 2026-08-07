<script lang="ts">
	import { UserGames, UserElo, SEO, UserAvatar } from "@/components";
	import { Button, Card } from "@/modules/cdk";
	import { account } from "@/lib/account.svelte";
	import { dateFromObjectId } from "@/utils";
	import { countryFlag, countryName } from "@/lib/countries";
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
	let username = $derived(data.user.account.username);
	// The load function 404s if the user doesn't exist, so `_id` is always set here.
	let userId = $derived(data.user._id!);
	let joinDate = $derived(dateFromObjectId(userId));
</script>

<SEO
	title={`${username}'s profile`}
	description={data.user.account.bio ||
		`${username} joined in ${dateFromObjectId(userId).toLocaleString("en", {
			month: "long",
		})} ${dateFromObjectId(userId).toLocaleString("en", { year: "numeric" })} and has ${data.user.account.karma} karma.`}
	image={`${page.url.origin}/api/user/${userId}/avatar`}
/>

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
				☯️ <a href={resolve("/(app)/page/[part1]", { part1: "karma" })} title="karma">{data.user.account.karma}</a>
				karma <br />
				{#if data.user.account.country}
					{countryFlag(data.user.account.country)}
					{countryName(data.user.account.country)} <br />
				{/if}
				🎉 Joined us in {joinDate.toLocaleString("en", { month: "long" })}
				{joinDate.toLocaleString("default", { year: "numeric" })}!
			</div>
			{#if data.user.account.bio}<p class="mt-2" title={`${data.user.account.username}'s bio`}>
					📝 {data.user.account.bio}
				</p>{/if}
			{#if data.user && $account?._id === data.user._id}
				<Button color="primary" href="/account" class="mt-2">✏️ Edit profile</Button>
				{#if !data.user.account.bio || !data.user.account.country}
					<p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
						{#if !data.user.account.bio && !data.user.account.country}
							Your profile looks empty — add a bio and your country so other players see them here.
						{:else if !data.user.account.bio}
							Add a bio so other players see it here.
						{:else}
							Add your country so other players see the flag here.
						{/if}
					</p>
				{/if}
			{/if}
		</div>
		<div class="grow-[3]">
			<UserGames {userId} />

			<Card class="border-gray-300 mt-4 dark:border-gray-600" header="Statistics">
				<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
					<div class="mb-3">
						<UserElo gamePreferences={data.elo} />
					</div>
					<div>
						<h3 class="text-lg font-semibold">Tournaments</h3>
						<p>No Tournament info available</p>
					</div>
				</div>
			</Card>
		</div>
	</div>
</div>
