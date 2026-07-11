<script lang="ts">
  import "bootstrap/dist/css/bootstrap.min.css";
  import "../../style.css";

  import { Appbar, Footer } from "@/components";
  import { activeGames } from "@/lib/stores.svelte";
  import { initNProgress } from "@/lib/nprogress.svelte";

  initNProgress();

  let { data, children } = $props();
</script>

<svelte:head>
  <link
    rel="shortcut icon"
    type="image/png"
    id="favicon-site"
    href={$activeGames.length > 0 ? "/favicon-active.ico" : "/favicon.ico"}
  />
</svelte:head>

<div id="app" style="flex-grow: 1; display: flex; flex-direction: column">
  <Appbar class="mb-3" />
  <main class="container-fluid p-relative mb-auto">
    {@render children()}
  </main>
  <Footer />
</div>

<style>
  :global(html) {
    min-height: 100%;
    height: 100%;
  }

  :global(body) {
    margin: 0;
    min-height: 100%;
    height: 100%;
  }

  #app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
</style>
