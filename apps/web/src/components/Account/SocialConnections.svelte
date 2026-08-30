<script lang="ts">
	import { Button } from "@/modules/cdk";
	import { del } from "@/lib/api";
	import { account } from "@/lib/account.svelte";
	import { confirm, handleError, handleSuccess } from "@/utils";
	import type { UserFront } from "@bgs/models";
	import type { Pathname } from "$app/types";
	import { m } from "@/lib/i18n/messages";

	const providers = ["google", "discord", "facebook", "github", "huggingface"] as const;
	type Provider = (typeof providers)[number];

	const labels: Record<Provider, string> = {
		google: "Google",
		discord: "Discord",
		facebook: "Facebook",
		github: "GitHub",
		huggingface: "Hugging Face",
	};

	let { user }: { user: UserFront } = $props();

	let connectedCount = $derived(providers.filter((provider) => !!user.account.social?.[provider]).length);
	// Mirrors the api guard (DELETE /account/social/:provider): a user with no
	// password and a single social login must not lock themselves out.
	let canDisconnect = $derived(!!user.account.hasPassword || connectedCount >= 2);
	let busy = $state(false);

	async function disconnect(provider: Provider) {
		if (!(await confirm(m.account_socialDisconnectConfirm({ provider: labels[provider] })))) {
			return;
		}
		busy = true;
		try {
			account.set(await del<UserFront>(`/account/social/${provider}`));
			handleSuccess(m.account_socialDisconnected({ provider: labels[provider] }));
		} catch (err) {
			handleError(err);
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-2">
	{#each providers as provider (provider)}
		{@const meta = user.account.socialMeta?.[provider]}
		<div class="flex flex-wrap items-center gap-2">
			<span class="w-28 text-sm font-medium">{labels[provider]}</span>
			{#if user.account.social?.[provider]}
				<span class="text-sm text-green-600 dark:text-green-400">✓ {m.account_socialConnected()}</span>
				{#if meta?.username}
					{#if meta.url}
						<a class="text-sm" href={meta.url} target="_blank" rel="noopener noreferrer">{meta.username}</a>
					{:else}
						<span class="text-sm">{meta.username}</span>
					{/if}
				{/if}
				<Button size="sm" outline color="danger" disabled={busy || !canDisconnect} onclick={() => disconnect(provider)}>
					{m.account_socialDisconnect()}
				</Button>
			{:else}
				<!-- OAuth endpoints are not app routes: off-site navigation (rel="external"). -->
				<Button size="sm" color={provider} href={`/auth/${provider}` as Pathname} rel="external">
					{m.account_socialConnect()}
				</Button>
			{/if}
		</div>
	{/each}
	{#if connectedCount > 0 && !canDisconnect}
		<span class="text-xs text-gray-500 dark:text-gray-400">{m.account_socialLastLogin()}</span>
	{/if}
</div>
