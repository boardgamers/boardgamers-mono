<script lang="ts">
	import { browser } from "$app/environment";
	import { account, room as roomStore } from "@/lib/stores.svelte";
	import ChatRoom from "./ChatRoom.svelte";

	// Public chat room entry point (#91): the same floating chat button + modal as
	// in-game chat, pointed at a public room (per-boardgame "boardgame:<slug>", or
	// the dormant site-wide lobby). Logged-in users only — posting requires an
	// account anyway, and the unread badge needs a lastRead marker.
	let { room, title }: { room: string; title: string } = $props();

	// Subscribe the shared websocket to the room while mounted (re-runs when the
	// room changes, e.g. navigating between boardgame pages). Guarded updates:
	// never clobber a room some other page set (game pages own the store on their
	// routes), and only clear our own subscription on teardown/logout.
	$effect(() => {
		if (!browser) return;
		const target = room;
		if ($account) {
			roomStore.update((current) => current ?? target);
		}
		return () => roomStore.update((current) => (current === target ? null : current));
	});
</script>

{#if $account}
	<!-- `corner`: unlike game pages there's no sidebar FAB on these routes, so the
	     chat button takes the standard bottom-right corner slot. -->
	<ChatRoom {room} {title} corner />
{/if}
