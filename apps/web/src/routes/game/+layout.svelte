<script lang="ts">
  import "../../app.css";

  import { Appbar, Sidebar } from "@/components";
  import { activeGames } from "@/lib/stores.svelte";
  import { initNProgress } from "@/lib/nprogress.svelte";

  initNProgress();

  let { children } = $props();
</script>

<svelte:head>
  <link
    rel="shortcut icon"
    type="image/png"
    id="favicon-site"
    href={$activeGames.length > 0 ? "/favicon-active.ico" : "/favicon.ico"}
  />
</svelte:head>

<div class="flex min-h-screen flex-col">
  <div class="flex flex-1 flex-row">
    <div class="flex flex-1 flex-col">
      <Appbar class="mb-3" />
      <main class="container mx-auto flex-1 px-4">
        {@render children()}
      </main>
    </div>
    <Sidebar />
  </div>
</div>
