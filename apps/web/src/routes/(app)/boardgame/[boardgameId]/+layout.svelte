<script lang="ts">
	// Subpath import: the @bgs/models root pulls mongodb into the browser bundle.
	import { boardgameRoomId } from "@bgs/models/chatroom";
	import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
	import PublicRoomChat from "@/components/PublicRoomChat.svelte";
	import { provideGamePreferences } from "@/lib/game-preferences.svelte";
	import { gameDisplayName } from "@/utils/game-label";
	import type { Snippet } from "svelte";
	import type { LayoutProps } from "./$types";

	let { data, children }: LayoutProps & { children: Snippet } = $props();

	// Per-boardgame public chat room (#91) on every page of the boardgame section.
	// Public versions only: the api 404s the room otherwise (a beta game reached
	// via a tester grant has no public room yet).
	let chatBoardgame = $derived(data.gameInfo?.public ? data.gameInfo._id.game : null);

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
