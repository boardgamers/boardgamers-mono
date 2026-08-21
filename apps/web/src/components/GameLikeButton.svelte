<script lang="ts">
	import IconMeeple from "@/components/icons/IconMeeple.svelte";
	import IconMeepleFill from "@/components/icons/IconMeepleFill.svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { del, post } from "@/lib/api";
	import { account, applyLikedBoardgame } from "@/lib/stores.svelte";
	import { live } from "@/lib/stores.svelte";
	import { handleError } from "@/utils";
	import { loginRedirectQuery } from "@/utils/redirect";
	import type { UserFront } from "@bgs/models";
	import { m } from "@/lib/i18n/messages";

	let {
		gameId,
		liked,
		likeCount,
		onlike,
		ssrUser,
	}: {
		gameId: string;
		liked: boolean;
		likeCount: number;
		// Fired after a successful toggle, so the parent can propagate the new like
		// state to every other read path (page snapshot, sidebar, catalog).
		onlike?: (like: { liked: boolean; likeCount: number }) => void;
		// The viewer as SSR'd by the page's load. Lets the button (and its liked state)
		// render in the server HTML — the client-only `$account` store is null during
		// SSR, so gating on it alone would pop the button in only after hydration.
		ssrUser?: UserFront | null;
	} = $props();

	// SSR renders the snapshot; the client trusts the seeded account store (live()).
	let user = $derived(live($account, ssrUser ?? null));
	let pending = $state(false);

	async function toggle(e: MouseEvent) {
		// The button is nested inside clickable cards (e.g. /new-game, /boardgames) — don't
		// let the like click bubble up and trigger the card's navigation.
		e.stopPropagation();
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
			const like = liked
				? await del<{ liked: boolean; likeCount: number }>(`/boardgame/${gameId}/like`)
				: await post<{ liked: boolean; likeCount: number }>(`/boardgame/${gameId}/like`);
			// Keep the sidebar's "freshest first" ordering live: a like stamps `now`
			// (refreshing the game's position in "My games"), an unlike re-sorts it by
			// its last-played recency.
			applyLikedBoardgame(gameId, like.liked);
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
