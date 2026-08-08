<script lang="ts">
	import { handleError, handleInfo, handleSuccess, confirm, niceDate, duration, createWatcher } from "@/utils";
	import { Card, Button, FormGroup, Input, InputGroup, Checkbox } from "@/modules/cdk";
	import { upperFirst, debounce } from "lodash";
	import { account } from "@/lib/account.svelte";
	import { post, apiFetch } from "@/lib/api";
	import type { UserFront } from "@bgs/models";
	import { browser } from "$app/environment";
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { untrack } from "svelte";
	import { developerSettings } from "@/lib/stores.svelte";
	import { useLoggedIn } from "@/lib/auth-guards.svelte";
	import UserAvatar from "@/components/User/UserAvatar.svelte";
	import CountrySelect from "@/components/Form/CountrySelect.svelte";
	import { logoClick, live } from "@/lib/stores.svelte";

	useLoggedIn();

	// SSR renders the snapshot; the client trusts the seeded account store (see stores.svelte.ts).
	let user = $derived(live($account, (page.data.user as UserFront | null) ?? null));

	// Editable form fields: seeded from `user` once, then mutated locally.
	// untrack() marks the one-time capture as intentional (not a reactive-read bug).
	let email = $state(untrack(() => user?.account.email ?? ""));
	let editingEmail = $state(false);
	let notifications = $state(browser ? !!localStorage.getItem("notifications") : false);
	let newsletter = $state(untrack(() => user?.settings?.mailing?.newsletter ?? false));
	let soundNotification = $state(untrack(() => user?.settings?.game?.soundNotification ?? false));
	let gameNotification = $state(untrack(() => user?.settings?.mailing?.game?.activated ?? false));
	let gameNotificationDelay = $state(untrack(() => user?.settings?.mailing?.game?.delay ?? 30 * 60));
	let tc = $state(false);
	let editingAvatar = $state(false);
	let avatarReload = $state(0);
	let fileUpload = $state<HTMLInputElement>();

	let bio = $derived(user?.account.bio ?? "");
	let country = $derived(user?.account.country ?? "");

	const avatarStyles = [
		"adventurer",
		"adventurer-neutral",
		"avataaars",
		"big-ears",
		"big-ears-neutral",
		"big-smile",
		"bottts",
		"croodles",
		"croodles-neutral",
		"gridy",
		"identicon",
		"initials",
		"jdenticon",
		"micah",
		"miniavs",
		"open-peeps",
		"personas",
		"pixel-art",
		"pixel-art-neutral",
	];

	async function acceptTC() {
		const accepted = await confirm("The terms and conditions will be marked as accepted at today's date.");

		if (!accepted) {
			tc = false;
			return;
		}

		try {
			account.set(await post("/account/terms-and-conditions"));
		} catch (err) {
			handleError(err);
		}
	}

	const selectArt = (art: string) =>
		post<UserFront>("/account", {
			account: {
				avatar: art,
			},
		})
			.then((r) => {
				account.set(r);
				avatarReload++;
			}, handleError)
			.finally(() => {
				editingAvatar = false;
				logoClick();
			});

	const updateAccount = debounce(
		() => {
			post<UserFront>("/account", {
				settings: {
					mailing: {
						newsletter,
						game: {
							activated: gameNotification,
							delay: gameNotificationDelay,
						},
					},
					game: {
						soundNotification,
					},
				},
			}).then((r) => account.set(r), handleError);
		},
		800,
		{ leading: false }
	);

	const updateBio = (bio: string) =>
		post<UserFront>("/account", {
			account: {
				bio,
			},
		}).then((r) => account.set(r), handleError);

	const updateCountry = (country: string) =>
		post<UserFront>("/account", {
			account: {
				country,
			},
		}).then((r) => account.set(r), handleError);

	async function saveEmail() {
		try {
			account.set(await post("/account/email", { email }));
		} catch (err) {
			handleError(err);
		}
	}

	const onNotificationsChanged = createWatcher(() => {
		if (notifications) {
			if (Notification.permission !== "granted") {
				Notification.requestPermission();
			}
		}

		if (!!localStorage.getItem("notifications") !== notifications) {
			localStorage.setItem("notifications", notifications ? "1" : "");
		}
	});

	let customAvatarError = $state(false);

	async function uploadAvatar(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];

		if (!file) {
			return;
		}

		const resp = await apiFetch("/account/avatar", { method: "POST", body: file });
		if (!resp.ok) {
			handleError("Error during upload (" + resp.status + ")");
			return;
		}
		editingAvatar = false;
		customAvatarError = false;
		avatarReload++;
		await invalidateAll();
	}

	$effect(() => {
		notifications;
		onNotificationsChanged();
	});
</script>

<svelte:head>
	<title>Account</title>
</svelte:head>

{#if user}
	<div class="container mx-auto px-4">
		<div class="grid grid-cols-2">
			<div>
				<h1>{user.account.username}</h1>
			</div>
			<div class="text-right">
				<Button color="primary" href={`/user/${user.account.username}` as Pathname}>Profile</Button>
			</div>
		</div>

		<Card class="mt-4 border-accent" header="User Settings">
			{#if !editingAvatar}
				{#key avatarReload}
					<UserAvatar
						--avatar-border="1px solid gray"
						role="button"
						onclick={() => (editingAvatar = true)}
						userId={user._id}
						username={user.account.username}
					/>
				{/key}
			{:else}
				<input type="file" bind:this={fileUpload} onchange={uploadAvatar} accept="image/*" class="hidden" />
				<a
					href="#upload"
					style="width: 100%"
					role="button"
					onclick={(e) => {
						e.preventDefault();
						fileUpload?.click();
					}}>Upload</a
				>
				<div style="display: contents" class:hidden={customAvatarError}>
					<UserAvatar
						userId={user._id}
						username="Custom avatar"
						role="button"
						onerror={() => (customAvatarError = true)}
						onload={() => (customAvatarError = false)}
						onclick={() => selectArt("upload")}
					/>
				</div>
				{#each avatarStyles as art (art)}
					<UserAvatar {art} username={user.account.username} role="button" onclick={() => selectArt(art)} />
				{/each}
			{/if}
			<FormGroup class="mt-2">
				<label for="bio">Bio</label>
				<Input
					type="textarea"
					id="bio"
					placeholder="Something about yourself..."
					value={bio}
					onchange={(event) => updateBio((event.target as HTMLTextAreaElement).value)}
				/>
			</FormGroup>
			<FormGroup class="mt-2">
				<label for="country">Country</label>
				<CountrySelect id="country" value={country} onselect={updateCountry} />
				<span class="text-xs">Shown next to your name in rankings and on your profile.</span>
			</FormGroup>
			<FormGroup class="mt-2">
				<label for="email">Email</label>
				<InputGroup>
					<Input
						type="email"
						id="email"
						placeholder="Email address"
						bind:value={email}
						onkeyup={(e) => {
							if (e.code === "Enter") {
								e.preventDefault();
								e.stopPropagation();
								saveEmail();
							}
						}}
						disabled={!editingEmail}
					/>

					{#if !editingEmail}
						<Button outline color="secondary" onclick={() => (editingEmail = true)}>Edit</Button>
					{:else}
						<Button outline color="success" onclick={saveEmail}>Save</Button>
					{/if}
				</InputGroup>
				<span class="text-xs"
					>{user.security.confirmed ? "Your email is confirmed." : "Your email is not confirmed."}</span
				>
			</FormGroup>
			<p class="mb-3 flex flex-wrap items-center gap-2">
				Connect with

				<!-- OAuth endpoints are not app routes: off-site navigation (rel="external"). -->
				{#each ["google", "discord", "facebook"] as const as social (social)}
					<Button
						color={social}
						disabled={!!(user.account.social && user.account.social[social])}
						href={`/api/account/auth/${social}` as Pathname}
						aria-disabled={!!(user.account.social && user.account.social[social])}
						rel="external"
					>
						{upperFirst(social)}
					</Button>
				{/each}
			</p>
			{#if !user.account.termsAndConditions}
				<Checkbox bind:checked={tc} onchange={acceptTC} class="mb-3">
					I agree to the <a href={resolve("/(app)/page/[part1]", { part1: "terms-and-conditions" })}
						>Terms and Conditions</a
					> 📝
				</Checkbox>
			{:else}
				<p>
					I accepted the <a href={resolve("/(app)/page/[part1]", { part1: "terms-and-conditions" })}
						>Terms and Conditions</a
					>
					on
					{niceDate(user.account.termsAndConditions)}.
				</p>
			{/if}
			<hr />
			<div class="space-y-2">
				<Checkbox bind:checked={newsletter} onchange={updateAccount}
					>Get newsletter, up to six emails per year.</Checkbox
				>
				<div class="flex flex-row items-center gap-3">
					<div class="flex-shrink-0">
						<Checkbox bind:checked={gameNotification} onchange={updateAccount}>
							Receive an email when it's your turn after a delay of
						</Checkbox>
					</div>
					<div class="flex-shrink-0">
						<select
							class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
							bind:value={gameNotificationDelay}
							onblur={() => {
								gameNotification = true;
								updateAccount();
							}}
						>
							{#each [60, 5 * 60, 10 * 60, 30 * 60, 2 * 3600, 6 * 3600, 12 * 3600] as seconds (seconds)}
								<option value={seconds}>
									{duration(seconds)}
								</option>
							{/each}
						</select>
					</div>
				</div>
			</div>
			<hr />
			<Checkbox bind:checked={$developerSettings}>🔧 Enable developper settings on this device</Checkbox>
			{#if $developerSettings}
				<div
					class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-gray-300 p-3 dark:border-gray-600"
				>
					<span class="text-sm text-gray-500 dark:text-gray-400">Test notifications:</span>
					<Button size="sm" color="primary" outline onclick={() => handleInfo("ℹ️ This is an info notification.")}
						>Info</Button
					>
					<Button size="sm" color="accent" outline onclick={() => handleSuccess("✅ This is a success notification.")}
						>Success</Button
					>
					<Button size="sm" color="danger" outline onclick={() => handleError("🚨 This is an error notification.")}
						>Error</Button
					>
					<Button
						size="sm"
						color="secondary"
						outline
						onclick={async () => {
							const ok = await confirm("This is a test confirmation dialog. Proceed?");
							handleInfo(ok ? "You clicked OK ✅" : "You clicked Cancel ❌");
						}}>Confirm</Button
					>
				</div>
			{/if}
		</Card>
		<Card class="mt-4 border-accent" header="Game Settings">
			<div class="space-y-2">
				<Checkbox bind:checked={soundNotification} onchange={updateAccount}>
					Play a sound when it's your turn in one of your games
				</Checkbox>
				<Checkbox bind:checked={notifications}>Notification on this device when it's your turn</Checkbox>
			</div>
		</Card>
	</div>
{/if}
