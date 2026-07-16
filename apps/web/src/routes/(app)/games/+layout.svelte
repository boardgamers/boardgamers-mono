<script lang="ts">
  import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
  let { children } = $props();
</script>

<div class="flex flex-row gap-4">
  <GameListSidebar />
  {@render children()}
</div>
