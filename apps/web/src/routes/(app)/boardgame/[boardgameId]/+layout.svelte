<script lang="ts">
	// Subpath import: the @bgs/models root pulls mongodb into the browser bundle.
	import { boardgameRoomId } from "@bgs/models/chatroom";
	import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
	import PublicRoomChat from "@/components/PublicRoomChat.svelte";
	import { chatRoomAccessible } from "@/lib/boardgame-chat";
	import { gameInfosState } from "@/lib/game-info.svelte";
	import { provideGamePreferences } from "@/lib/game-preferences.svelte";
	import { account } from "@/lib/stores.svelte";
	import { gameDisplayName } from "@/utils/game-label";
	import type { Snippet } from "svelte";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	// Per-boardgame chat room (#91) on every page of the boardgame section, shown
	// when the api would serve the room (see chatRoomAccessible) — decided on ALL
	// the versions the user can see, NOT the picked-latest `data.gameInfo` (for a
	// beta grantee that's their private grant even when public versions exist).
	const gameInfos = gameInfosState();
	let chatBoardgame = $derived.by(() => {
		const boardgame = data.gameInfo?._id.game;
		if (!boardgame) {
			return null;
		}
		const versions = Object.values(gameInfos).filter((info) => info._id.game === boardgame);
		return chatRoomAccessible(versions, !!$account) ? boardgame : null;
	});

	// SSR: provide this boardgame's SSR-fetched prefs via context during init so descendants
	// render them server-side (setContext must run at init; $effect does NOT run during SSR).
	// On the client the layout load's getters already populate the stores — no seeding here.
	const ssrPreferences = () => data.preferences;
	if (ssrPreferences()) {
		provideGamePreferences({ [ssrPreferences()!.game]: ssrPreferences()! });
	}
</script>

<div class="flex flex-row gap-4">
	<GameListSidebar />
	{@render children()}
</div>

{#if chatBoardgame}
	<PublicRoomChat room={boardgameRoomId(chatBoardgame)} title={gameDisplayName(data.gameInfo)} />
{/if}
