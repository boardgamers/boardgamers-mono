<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const { loadGameInfos } = useLoad(input, useGameInfo);

    await loadGameInfos();

    return {};
  }
</script>

<script lang="ts">
  import type { LoadInput } from "@sveltejs/kit";
  import { useLoad } from "@/composition/useLoad";
  import { useGameInfo } from "@/composition/useGameInfo";
  import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
</script>

<div class="d-flex">
  <GameListSidebar />
  <slot />
</div>
