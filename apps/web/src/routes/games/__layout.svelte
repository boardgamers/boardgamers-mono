<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const { loadGameInfos } = useLoad(input, useGameInfo);

    await loadGameInfos();

    return {};
  }
</script>

<script lang="ts">
  import GameListSidebar from "$lib/components/Layout/GameListSidebar.svelte";
  import { useGameInfo } from "$lib/composition/useGameInfo";
  import { useLoad } from "$lib/composition/useLoad";
  import type { LoadInput } from "@sveltejs/kit";
</script>

<div class="d-flex">
  <GameListSidebar />
  <slot />
</div>
