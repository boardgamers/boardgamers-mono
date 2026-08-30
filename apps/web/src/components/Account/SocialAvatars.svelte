<script lang="ts">
	import { post } from "@/lib/api";
	import { account } from "@/lib/account.svelte";
	import { handleError } from "@/utils";
	import type { UserFront } from "@bgs/models";
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

	let { user, size = "4rem", onselected }: { user: UserFront; size?: string; onselected?: () => void } = $props();

	// Only connected providers whose OAuth profile carried a usable avatar URL
	// (captured at link/login time into socialMeta) get an option.
	let available = $derived(
		providers.filter(
			(provider) => !!user.account.social?.[provider] && !!user.account.socialMeta?.[provider]?.avatarUrl
		)
	);

	let busy = $state(false);

	// The api copies the image server-side into the regular avatar storage (same
	// pipeline as an upload) — afterwards it behaves exactly like an uploaded
	// avatar, so unlinking the provider later doesn't break it.
	async function select(provider: Provider) {
		if (busy) {
			return;
		}
		busy = true;
		try {
			account.set(await post<UserFront>("/account/avatar/social", { provider }));
			onselected?.();
		} catch (err) {
			handleError(err);
		} finally {
			busy = false;
		}
	}
</script>

{#each available as provider (provider)}
	<!-- The thumbnail hotlinks the provider CDN; selecting copies it server-side. -->
	<button
		type="button"
		title={m.account_socialAvatar({ provider: labels[provider] })}
		disabled={busy}
		class="social-avatar-button"
		onclick={() => select(provider)}
	>
		<img
			src={user.account.socialMeta?.[provider]?.avatarUrl}
			alt={m.account_socialAvatar({ provider: labels[provider] })}
			style="height: {size}; width: {size}"
			class="social-avatar"
			class:opacity-50={busy}
		/>
	</button>
{/each}

<style>
	.social-avatar-button {
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		line-height: 0;
	}

	/* Mirrors UserAvatar's circle styling so provider options sit naturally in the picker. */
	.social-avatar {
		border-radius: 50%;
		border: var(--avatar-border, 1px solid rgb(156 163 175)); /* gray-400 default */
		background-color: rgb(229 231 235); /* gray-200 */
		object-fit: cover;
		cursor: pointer;
	}

	:global(.dark) .social-avatar {
		background-color: rgb(31 41 55); /* gray-800 */
		border: var(--avatar-border, 1px solid rgb(75 85 99)); /* gray-600 default */
	}
</style>
