<script lang="ts">
	import { handleError, handleInfo, handleSuccess, confirm, niceDate, duration, createWatcher } from "@/utils";
	import { Card, Button, FormGroup, Input, InputGroup, Checkbox } from "@/modules/cdk";
	import { debounce } from "lodash";
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
	import SocialConnections from "@/components/Account/SocialConnections.svelte";
	import CountrySelect from "@/components/Form/CountrySelect.svelte";
	import { logoClick, live, avatarVersion, bumpAvatarVersion } from "@/lib/stores.svelte";
	import { m } from "@/lib/i18n/messages";

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
			handleSuccess(m.account_webhookSaved());
		} catch (err) {
			handleError(err);
		}
	}

	async function testWebhook() {
		webhookTesting = true;
		try {
			const res = await post<{ success: boolean; error?: string }>("/account/webhook/test");
			if (res.success) {
				handleSuccess(m.account_webhookTestSent());
			} else {
				handleError(m.account_webhookTestFailed({ error: res.error ?? "" }));
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
			handleSuccess(m.account_webhookRemoved());
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
		const accepted = await confirm(m.account_confirmAcceptTerms());

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
			handleError(m.account_uploadError({ status: resp.status }));
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
				<Button color="primary" href={`/user/${user.account.username}` as Pathname}
					>{m.account_viewPublicProfile()}</Button
				>
			</div>
		</div>

		<Card class="mt-4 border-accent" header={m.account_profile()}>
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
					<Button color="primary" onclick={() => fileUpload?.click()}>{m.account_uploadAvatar()}</Button>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<div class:hidden={customAvatarError}>
						<UserAvatar
							userId={user._id}
							username={m.account_customAvatar()}
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
				<label for="bio">{m.account_bio()}</label>
				<Input
					type="textarea"
					id="bio"
					placeholder={m.account_bioPlaceholder()}
					value={bio}
					onchange={(event) => updateBio((event.target as HTMLTextAreaElement).value)}
				/>
			</FormGroup>
			<FormGroup class="mt-2">
				<label for="country">{m.account_country()}</label>
				<CountrySelect id="country" value={country} onselect={updateCountry} />
				<span class="text-xs">{m.account_countryHelp()}</span>
			</FormGroup>
		</Card>

		<Card class="mt-4 border-accent" header={m.account_account()}>
			<FormGroup class="mt-2">
				<label for="email">{m.common_email()}</label>
				<InputGroup>
					<Input
						type="email"
						id="email"
						placeholder={m.common_emailAddress()}
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
						<Button outline color="secondary" onclick={() => (editingEmail = true)}>{m.common_edit()}</Button>
					{:else}
						<Button outline color="success" onclick={saveEmail}>{m.common_save()}</Button>
					{/if}
				</InputGroup>
				<span class="text-xs"
					>{user.security.confirmed ? m.account_emailConfirmed() : m.account_emailNotConfirmed()}</span
				>
			</FormGroup>
			<div class="mb-3">
				<p class="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-300">{m.account_socialAccounts()}</p>
				<p class="mb-2 text-xs text-gray-500 dark:text-gray-400">{m.account_socialAccountsHelp()}</p>
				<SocialConnections {user} />
			</div>
			{#if !user.account.termsAndConditions}
				<Checkbox bind:checked={tc} onchange={acceptTC} class="mb-3">
					{m.account_agreeTerms()}
					<a href={resolve("/(app)/page/[part1]", { part1: "terms-and-conditions" })}
						>{m.account_termsAndConditions()}</a
					> 📝
				</Checkbox>
			{:else}
				<p>
					{m.account_acceptedTerms()}
					<a href={resolve("/(app)/page/[part1]", { part1: "terms-and-conditions" })}
						>{m.account_termsAndConditions()}</a
					>
					{m.account_on()}
					{niceDate(user.account.termsAndConditions)}.
				</p>
			{/if}
		</Card>

		<Card class="mt-4 border-accent" header={m.account_notifications()}>
			<p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
				{m.account_notificationsHelp()}
			</p>

			<FormGroup>
				<Checkbox bind:checked={newsletter} onchange={updateAccount}>{m.account_newsletter()}</Checkbox>
				<span class="text-xs">{m.account_newsletterHelp()}</span>
			</FormGroup>

			<hr />
			<p class="mb-2 text-sm font-semibold text-gray-600 dark:text-gray-300">{m.account_yourTurn()}</p>

			<FormGroup>
				<Checkbox bind:checked={gameNotification} onchange={updateAccount}>{m.account_emailMe()}</Checkbox>
				{#if gameNotification}
					<div class="ms-6 mt-1 flex items-center gap-2">
						<label for="game-notification-delay" class="text-sm text-gray-500 dark:text-gray-400"
							>{m.account_afterDelay()}</label
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
				<span class="text-xs">{m.account_emailMeHelp()}</span>
			</FormGroup>

			<FormGroup>
				<Checkbox bind:checked={notifications}>{m.account_browserNotification()}</Checkbox>
				<span class="text-xs">{m.account_browserNotificationHelp()}</span>
			</FormGroup>

			<FormGroup>
				<Checkbox bind:checked={soundNotification} onchange={updateAccount}>{m.account_playSound()}</Checkbox>
				<span class="text-xs">{m.account_playSoundHelp()}</span>
			</FormGroup>

			<hr />
			<FormGroup>
				<label for="notification-webhook">{m.account_webhook()}</label>
				{#if webhookConfigured && !webhookEditing}
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm">{m.account_webhookConfigured({ format: webhookFormat })}</span>
						<Button size="sm" outline color="secondary" onclick={() => (webhookEditing = true)}
							>{m.account_webhookChange()}</Button
						>
						<Button size="sm" outline color="primary" disabled={webhookTesting} onclick={testWebhook}>
							{m.account_webhookTest()}
						</Button>
						<Button size="sm" outline color="danger" onclick={removeWebhook}>{m.account_webhookRemove()}</Button>
					</div>
				{:else}
					<InputGroup>
						<Input
							type="url"
							id="notification-webhook"
							placeholder="https://discord.com/api/webhooks/…"
							bind:value={webhookUrl}
						/>
						<Button outline color="success" disabled={!webhookUrl} onclick={saveWebhook}>{m.common_save()}</Button>
						{#if webhookConfigured}
							<Button outline color="secondary" onclick={() => (webhookEditing = false)}>{m.common_cancel()}</Button>
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
							{m.common_enabled()}
						</Checkbox>
						<span class="flex items-center gap-2">
							<label for="webhook-delay" class="text-sm text-gray-500 dark:text-gray-400">{m.account_deliver()}</label>
							<select
								id="webhook-delay"
								class="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
								bind:value={webhookDelay}
								onchange={() => webhookConfigured && !webhookEditing && saveWebhook()}
							>
								<option value={0}>{m.account_immediately()}</option>
								{#each [60, 5 * 60, 10 * 60, 30 * 60, 2 * 3600] as seconds (seconds)}
									<option value={seconds}>{m.account_every({ duration: duration(seconds) })}</option>
								{/each}
							</select>
						</span>
					</div>
				{/if}
				{#if webhookDisabled}
					<span class="text-xs text-warning">{m.account_webhookDisabledWarning()}</span>
				{:else}
					<span class="text-xs">
						{m.account_webhookHelp()}
						{#if !webhookConfigured || webhookEditing}
							{m.account_webhookDiscordHelp()}
							<a
								href="https://support.discord.com/hc/en-us/articles/228383668"
								target="_blank"
								rel="noopener noreferrer">{m.account_webhookDiscordGuide()}</a
							>
						{/if}
					</span>
				{/if}
			</FormGroup>
		</Card>

		<Card class="mt-4 border-accent" header={m.account_developer()}>
			<Checkbox bind:checked={$developerSettings}>{m.account_enableDevSettings()}</Checkbox>
			{#if $developerSettings}
				<div
					class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-gray-300 p-3 dark:border-gray-600"
				>
					<span class="text-sm text-gray-500 dark:text-gray-400">{m.account_testNotifications()}</span>
					<Button size="sm" color="primary" outline onclick={() => handleInfo(m.account_testInfo())}>Info</Button>
					<Button size="sm" color="accent" outline onclick={() => handleSuccess(m.account_testSuccess())}
						>Success</Button
					>
					<Button size="sm" color="danger" outline onclick={() => handleError(m.account_testError())}>Error</Button>
					<Button
						size="sm"
						color="secondary"
						outline
						onclick={async () => {
							const ok = await confirm(m.account_testConfirm());
							handleInfo(ok ? m.account_testConfirmOk() : m.account_testConfirmCancel());
						}}>{m.auth_confirm()}</Button
					>
				</div>
			{/if}
		</Card>
	</div>
{/if}
