<script lang="ts">
	import { browser } from "$app/environment";
	// Subpath import: the @bgs/models root pulls mongodb into the browser bundle.
	import { LOBBY_ROOM } from "@bgs/models/chatroom";
	import { account, room } from "@/lib/stores.svelte";
	import { m } from "@/lib/i18n/messages";
	import ChatRoom from "./ChatRoom.svelte";

	// Lobby chat entry point (#91): the same floating chat button + modal as in-game
	// chat, pointed at the persistent public "lobby" room. Logged-in users only —
	// posting requires an account anyway, and the unread badge needs a lastRead marker.

	// Subscribe the shared websocket to the lobby room while mounted. Guarded updates:
	// never clobber a room some other page set (game pages own the store on their
	// routes), and only clear our own subscription on teardown/logout.
	$effect(() => {
		if (!browser) return;
		if ($account) {
			room.update((current) => current ?? LOBBY_ROOM);
		}
		return () => room.update((current) => (current === LOBBY_ROOM ? null : current));
	});
</script>

{#if $account}
	<ChatRoom room={LOBBY_ROOM} title={m.chat_lobbyTitle()} />
{/if}
