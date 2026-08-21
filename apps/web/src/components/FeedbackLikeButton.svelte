<script lang="ts">
	import IconMeeple from "@/components/icons/IconMeeple.svelte";
	import IconMeepleFill from "@/components/icons/IconMeepleFill.svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { del, post, put } from "@/lib/api";
	import { account, live } from "@/lib/stores.svelte";
	import { handleError } from "@/utils";
	import { loginRedirectQuery } from "@/utils/redirect";
	import type { UserFront } from "@bgs/models";
	import { m } from "@/lib/i18n/messages";

	type VoteTarget =
		// Whole-game requests reuse the gamelike endpoints (#340).
		| { kind: "game"; gameId: string }
		// Site / game-specific feedback requests have their own like endpoints.
		| { kind: "feedback"; requestId: string };

	let {
		target,
		liked,
		likeCount,
		onlike,
		ssrUser,
	}: {
		target: VoteTarget;
		liked: boolean;
		likeCount: number;
		// Fired after a successful toggle so the parent can update its list.
		onlike?: (like: { liked: boolean; likeCount: number }) => void;
		// The viewer as SSR'd by the page's load — $account is client-only, so
		// without it the liked state would pop in only after hydration.
		ssrUser?: UserFront | null;
	} = $props();

	let user = $derived(live($account, ssrUser ?? null));
	let pending = $state(false);

	async function toggle() {
		if (pending) {
			return;
		}
		if (!user) {
			// Logged-out: send to login and back to this page after a successful login.
			const loginTarget = resolve("/(app)/login") + loginRedirectQuery(page.url);
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- path is resolve()d above; the rule can't trace resolve() + query-string concatenation
			goto(loginTarget);
			return;
		}
		pending = true;
		try {
			const url = target.kind === "game" ? `/boardgame/${target.gameId}/like` : `/feedback/${target.requestId}/like`;
			const like = liked
				? await del<{ liked: boolean; likeCount: number }>(url)
				: target.kind === "game"
					? await post<{ liked: boolean; likeCount: number }>(url)
					: await put<{ liked: boolean; likeCount: number }>(url);
			onlike?.(like);
		} catch (err) {
			handleError(err);
		} finally {
			pending = false;
		}
	}
</script>

<button
	type="button"
	class="inline-flex items-center gap-1 rounded border px-2 py-1 text-sm disabled:opacity-60"
	class:border-primary={liked}
	class:text-primary={liked}
	class:dark:border-primary-lighter={liked}
	class:dark:text-primary-lighter={liked}
	class:border-gray-400={!liked}
	class:text-gray-500={!liked}
	class:dark:border-gray-600={!liked}
	class:dark:text-gray-400={!liked}
	aria-pressed={liked ? "true" : "false"}
	title={liked ? m.feedback_unvote() : m.feedback_vote()}
	disabled={pending}
	onclick={toggle}
>
	{#if liked}
		<IconMeepleFill />
	{:else}
		<IconMeeple />
	{/if}
	<span>{likeCount}</span>
</button>
