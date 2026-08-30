<script lang="ts">
	import { Button } from "@/modules/cdk";
	import { del } from "@/lib/api";
	import { account } from "@/lib/account.svelte";
	import { confirm, handleError, handleSuccess } from "@/utils";
	import type { UserFront } from "@bgs/models";
	import type { Pathname } from "$app/types";
	import { m } from "@/lib/i18n/messages";
	import IconGoogle from "@/components/icons/IconGoogle.svelte";
	import IconDiscord from "@/components/icons/IconDiscord.svelte";
	import IconFacebook from "@/components/icons/IconFacebook.svelte";
	import IconGithub from "@/components/icons/IconGithub.svelte";
	import IconHuggingFace from "@/components/icons/IconHuggingFace.svelte";

	const providers = ["google", "discord", "facebook", "github", "huggingface"] as const;
	type Provider = (typeof providers)[number];

	const labels: Record<Provider, string> = {
		google: "Google",
		discord: "Discord",
		facebook: "Facebook",
		github: "GitHub",
		huggingface: "Hugging Face",
	};

	const icons = {
		google: IconGoogle,
		discord: IconDiscord,
		facebook: IconFacebook,
		github: IconGithub,
		huggingface: IconHuggingFace,
	} as const;

	// Static literals: Tailwind's scanner can't see interpolated class names.
	const iconClasses: Record<Provider, string> = {
		google: "text-social-google",
		discord: "text-social-discord",
		facebook: "text-social-facebook",
		github: "text-social-github dark:text-gray-200",
		huggingface: "text-social-huggingface",
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

<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
	{#each providers as provider (provider)}
		{@const meta = user.account.socialMeta?.[provider]}
		{@const Icon = icons[provider]}
		<div class="flex items-center gap-2.5 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-700">
			<Icon size="1.4em" class="shrink-0 {iconClasses[provider]}" />
			<div class="min-w-0 flex-1">
				<div class="text-sm leading-tight font-medium">{labels[provider]}</div>
				{#if user.account.social?.[provider]}
					<div class="truncate text-xs leading-tight text-green-600 dark:text-green-400">
						✓ {m.account_socialConnected()}{#if meta?.username}<!--
						--><span class="text-gray-400 dark:text-gray-500"
								>&nbsp;·&nbsp;</span
							><!--
						-->{#if meta.url}<a href={meta.url} target="_blank" rel="noopener noreferrer">{meta.username}</a
								>{:else}<span class="text-gray-500 dark:text-gray-400">{meta.username}</span>{/if}{/if}
					</div>
				{:else}
					<div class="text-xs leading-tight text-gray-400 dark:text-gray-500">{m.account_socialNotConnected()}</div>
				{/if}
			</div>
			{#if user.account.social?.[provider]}
				<Button
					size="sm"
					outline
					color="danger"
					class="shrink-0"
					disabled={busy || !canDisconnect}
					onclick={() => disconnect(provider)}
				>
					{m.account_socialDisconnect()}
				</Button>
			{:else}
				<!-- OAuth endpoints are not app routes: off-site navigation (rel="external"). -->
				<Button size="sm" color={provider} class="shrink-0" href={`/auth/${provider}` as Pathname} rel="external">
					{m.account_socialConnect()}
				</Button>
			{/if}
		</div>
	{/each}
</div>
{#if connectedCount > 0 && !canDisconnect}
	<span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">{m.account_socialLastLogin()}</span>
{/if}
