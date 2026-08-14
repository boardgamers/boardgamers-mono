<script lang="ts">
	import IconHeart from "@/components/icons/IconHeart.svelte";
	import IconHeartFill from "@/components/icons/IconHeartFill.svelte";
	import { del, post } from "@/lib/api";
	import { account } from "@/lib/stores.svelte";
	import { handleError } from "@/utils";

	let {
		gameId,
		liked,
		likeCount,
		onlike,
	}: {
		gameId: string;
		liked: boolean;
		likeCount: number;
		// Fired after a successful toggle, so the parent can propagate the new like
		// state to every other read path (page snapshot, sidebar, catalog).
		onlike?: (like: { liked: boolean; likeCount: number }) => void;
	} = $props();

	let user = $derived($account);
	let pending = $state(false);

	async function toggle() {
		if (!user || pending) {
			return;
		}
		pending = true;
		try {
			const like = liked
				? await del<{ liked: boolean; likeCount: number }>(`/boardgame/${gameId}/like`)
				: await post<{ liked: boolean; likeCount: number }>(`/boardgame/${gameId}/like`);
			onlike?.(like);
		} catch (err) {
			handleError(err);
		} finally {
			pending = false;
		}
	}
</script>

{#if user}
	<button
		type="button"
		class="inline-flex items-center gap-1 rounded border px-2 py-1 text-sm disabled:opacity-60"
		class:border-red-300={liked}
		class:text-red-500={liked}
		class:dark:border-red-400={liked}
		class:dark:text-red-400={liked}
		class:border-gray-400={!liked}
		class:text-gray-500={!liked}
		class:dark:border-gray-600={!liked}
		class:dark:text-gray-400={!liked}
		aria-pressed={liked ? "true" : "false"}
		title={liked ? "Unlike this game" : "Like this game"}
		disabled={pending}
		onclick={toggle}
	>
		{#if liked}
			<IconHeartFill />
		{:else}
			<IconHeart />
		{/if}
		<span>{likeCount}</span>
	</button>
{:else if likeCount > 0}
	<span class="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400" title="{likeCount} likes">
		<IconHeartFill />
		<span>{likeCount}</span>
	</span>
{/if}
