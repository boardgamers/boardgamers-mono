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
	import { logoClick, live, avatarVersion, bumpAvatarVersion } from "@/lib/stores.svelte";

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

	// Notification webhook (#85/#33): the url is secret-ish — the api never sends
	// it back, only `hasWebhook`. `webhookConfigured` also flips true right after
	// a successful save so the field can be hidden again.
	let webhookUrl = $state("");
	let webhookFormat = $state<"discord" | "slack" | "raw">(
		untrack(() => user?.settings?.notifications?.webhook?.format ?? "discord")
	);
	let webhookEnabled = $state(untrack(() => user?.settings?.notifications?.webhook?.enabled ?? true));
	// Webhook delivery delay in seconds; 0 = immediate. Independent of the email delay.
	let webhookDelay = $state(untrack(() => user?.settings?.notifications?.webhook?.delay ?? 0));
	let webhookEditing = $state(false);
	let webhookTesting = $state(false);
	let webhookConfigured = $state(untrack(() => !!user?.settings?.notifications?.webhook?.hasWebhook));
	let webhookDisabled = $derived(user?.settings?.notifications?.webhook?.disabled ?? false);

	async function saveWebhook() {
		if (webhookUrl && !webhookUrl.startsWith("http")) {
			webhookEditing = true;
			return;
		}
		try {
			const r = await post<UserFront>("/account", {
				settings: {
					notifications: {
						webhook: {
							...(webhookUrl ? { url: webhookUrl } : {}),
							format: webhookFormat,
							enabled: webhookEnabled,
							delay: webhookDelay,
						},
					},
				},
			});
			account.set(r);
			if (webhookUrl) {
				webhookConfigured = true;
				webhookUrl = "";
				webhookEditing = false;
			}
			handleSuccess("Webhook settings saved");
		} catch (err) {
			handleError(err);
		}
	}

	async function testWebhook() {
		webhookTesting = true;
		try {
			const res = await post<{ success: boolean; error?: string }>("/account/webhook/test");
			if (res.success) {
				handleSuccess("✅ Test notification sent!");
			} else {
				handleError(`Test notification failed: ${res.error}`);
			}
		} catch (err) {
			handleError(err);
		} finally {
			webhookTesting = false;
		}
	}

	async function removeWebhook() {
		try {
			account.set(await post<UserFront>("/account", { settings: { notifications: { webhook: null } } }));
			webhookUrl = "";
			webhookConfigured = false;
			webhookEditing = false;
			handleSuccess("Webhook removed");
		} catch (err) {
			handleError(err);
		}
	}
	let tc = $state(false);
	let editingAvatar = $state(false);
	let fileUpload = $state<HTMLInputElement>();

	let bio = $derived(user?.account.bio ?? "");
	let country = $derived(user?.account.country ?? "");

	// Keep in sync with the whitelist in apps/api/app/models/avatar.ts.
	// ("gridy"/"jdenticon" were dropped: DiceBear v9 removed them.)
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
		"identicon",
		"initials",
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
				bumpAvatarVersion();
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
		bumpAvatarVersion();
		await invalidateAll();
	}

	$effect(() => {
		notifications;
		onNotificationsChanged();
	});
</script>

{#if user}
	<div class="container mx-auto px-4">
		<div class="grid grid-cols-2">
			<div>
				<h1>{user.account.username}</h1>
			</div>
			<div class="text-right">
				<Button color="primary" href={`/user/${user.account.username}` as Pathname}>View public profile</Button>
			</div>
		</div>

		<Card class="mt-4 border-accent" header="Profile">
			{#if !editingAvatar}
				{#key $avatarVersion}
					<UserAvatar
						--avatar-border="1px solid gray"
						role="button"
						onclick={() => (editingAvatar = true)}
						userId={user._id}
						username={user.account.username}
						v={$avatarVersion}
					/>
				{/key}
			{:else}
				<input type="file" bind:this={fileUpload} onchange={uploadAvatar} accept="image/*" class="hidden" />
				<div class="mb-2">
					<Button color="primary" onclick={() => fileUpload?.click()}>Upload a custom avatar</Button>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<div class:hidden={customAvatarError}>
						<UserAvatar
							userId={user._id}
							username="Custom avatar"
							role="button"
							v={$avatarVersion}
							onerror={() => (customAvatarError = true)}
							onload={() => (customAvatarError = false)}
							onclick={() => selectArt("upload")}
						/>
					</div>
					{#each avatarStyles as art (art)}
						<UserAvatar {art} username={user.account.username} role="button" onclick={() => selectArt(art)} />
					{/each}
				</div>
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
		</Card>

		<Card class="mt-4 border-accent" header="Account">
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
				{#each ["google", "discord", "facebook", "github", "huggingface"] as const as social (social)}
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
		</Card>

		<Card class="mt-4 border-accent" header="Notifications">
			<p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
				Choose how you're told when it's your turn: by email, on this device, or via a webhook.
			</p>

			<FormGroup>
				<Checkbox bind:checked={newsletter} onchange={updateAccount}>Newsletter</Checkbox>
				<span class="text-xs">Occasional news about the site, at most six emails per year.</span>
			</FormGroup>

			<hr />
			<p class="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-300">It&rsquo;s your turn</p>

			<FormGroup>
				<Checkbox bind:checked={gameNotification} onchange={updateAccount}>Email me</Checkbox>
				{#if gameNotification}
					<div class="ms-6 mt-1 flex items-center gap-2">
						<label for="game-notification-delay" class="text-sm text-gray-500 dark:text-gray-400"
							>after a delay of</label
						>
						<select
							id="game-notification-delay"
							class="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
							bind:value={gameNotificationDelay}
							onchange={updateAccount}
						>
							{#each [60, 5 * 60, 10 * 60, 30 * 60, 2 * 3600, 6 * 3600, 12 * 3600] as seconds (seconds)}
								<option value={seconds}>
									{duration(seconds)}
								</option>
							{/each}
						</select>
					</div>
				{/if}
				<span class="text-xs"
					>An email listing your waiting games, sent after the configured delay.</span
				>
			</FormGroup>

			<FormGroup>
				<Checkbox bind:checked={notifications}>Browser notification on this device</Checkbox>
				<span class="text-xs">A system notification from this browser, even when you're on another tab.</span>
			</FormGroup>

			<FormGroup>
				<Checkbox bind:checked={soundNotification} onchange={updateAccount}>Play a sound</Checkbox>
				<span class="text-xs">An audible cue while you have the site open.</span>
			</FormGroup>

			<hr />
			<FormGroup>
				<label for="notification-webhook">Webhook</label>
				{#if webhookConfigured && !webhookEditing}
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm">A webhook is configured (format: {webhookFormat}).</span>
						<Button size="sm" outline color="secondary" onclick={() => (webhookEditing = true)}>Change</Button>
						<Button size="sm" outline color="primary" disabled={webhookTesting} onclick={testWebhook}>
							Send test notification
						</Button>
						<Button size="sm" outline color="danger" onclick={removeWebhook}>Remove</Button>
					</div>
				{:else}
					<InputGroup>
						<Input
							type="url"
							id="notification-webhook"
							placeholder="https://discord.com/api/webhooks/…"
							bind:value={webhookUrl}
						/>
						<Button outline color="success" disabled={!webhookUrl} onclick={saveWebhook}>Save</Button>
						{#if webhookConfigured}
							<Button outline color="secondary" onclick={() => (webhookEditing = false)}>Cancel</Button>
						{/if}
					</InputGroup>
				{/if}
				{#if webhookConfigured || webhookEditing}
					<div class="ms-6 mt-1 flex flex-wrap items-center gap-3">
						<select
							class="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
							bind:value={webhookFormat}
							onchange={() => webhookConfigured && !webhookEditing && saveWebhook()}
						>
							{#each ["discord", "slack", "raw"] as const as format (format)}
								<option value={format}>{format}</option>
							{/each}
						</select>
						<Checkbox
							bind:checked={webhookEnabled}
							onchange={() => webhookConfigured && !webhookEditing && saveWebhook()}
						>
							Enabled
						</Checkbox>
						<span class="flex items-center gap-2">
							<label for="webhook-delay" class="text-sm text-gray-500 dark:text-gray-400">Deliver</label>
							<select
								id="webhook-delay"
								class="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
								bind:value={webhookDelay}
								onchange={() => webhookConfigured && !webhookEditing && saveWebhook()}
							>
								<option value={0}>Immediately</option>
								{#each [60, 5 * 60, 10 * 60, 30 * 60, 2 * 3600] as seconds (seconds)}
									<option value={seconds}>every {duration(seconds)}</option>
								{/each}
							</select>
						</span>
					</div>
				{/if}
				{#if webhookDisabled}
					<span class="text-xs text-warning"
						>⚠️ This webhook was disabled after 24h of failures. Save a new URL to re-enable it.</span
					>
				{:else}
					<span class="text-xs"
						>Post a message to Discord, Slack, or your own endpoint (raw JSON) when it's your turn: immediately, or
						batched at the chosen interval.</span
					>
				{/if}
			</FormGroup>
		</Card>

		<Card class="mt-4 border-accent" header="Developer">
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
	</div>
{/if}
