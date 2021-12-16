<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const { loadGameInfos, loadGamePreferences } = useLoad(input, useGameInfo, useGamePreferences);

    await loadGameInfos();
    await loadGamePreferences(input.page.params.boardgameId);

    return {};
  }
</script>

<script lang="ts">
  import type { LoadInput } from "@sveltejs/kit";
  import { useLoad } from "@/composition/useLoad";
  import { useGameInfo } from "@/composition/useGameInfo";
  import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
  import { useGamePreferences } from "@/composition/useGamePreferences";
</script>

<div class="d-flex">
  <GameListSidebar />
  <slot />
</div>
