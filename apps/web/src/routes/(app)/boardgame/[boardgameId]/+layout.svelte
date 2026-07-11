<script lang="ts">
  import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
  let { children } = $props();
</script>

<div class="d-flex">
  <GameListSidebar />
  {@render children()}
</div>
