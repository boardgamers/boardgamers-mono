<script lang="ts">
	import { sidebarOpen } from "@/lib/stores.svelte";
	import { Button } from "@/modules/cdk";
	import IconGear from "@/components/icons/IconGear.svelte";
	import { page } from "$app/state";
	import GameSidebar from "@/components/Game/GameSidebar.svelte";
	import { m } from "@/lib/i18n/messages";
</script>

<div class="sidebar-container" class:open={$sidebarOpen}>
	{#if $sidebarOpen}
		<button type="button" class="sidebar-scrim" aria-label={m.sidebar_close()} onclick={() => ($sidebarOpen = false)}
		></button>
	{/if}
	<aside class="px-3 pb-3 sidebar thin-scrollbar text-white">
		<div id="sidebar">
			{#if page.data.game}
				<GameSidebar />
			{/if}
		</div>
	</aside>
	<Button
		color="secondary"
		onclick={() => ($sidebarOpen = !$sidebarOpen)}
		class={"!rounded-full sidebar-fab" + (false ? " chatOpen" : "")}
	>
		<IconGear size="1.5rem" />
	</Button>
</div>
