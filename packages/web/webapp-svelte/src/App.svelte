<script lang="typescript">
  import { Appbar, Footer, Sidebar } from "@/components";
  import RouterView from "@/modules/router/RouterView.svelte";
  import { route } from "./modules/router";
  import { activeGames } from "./store";
</script>

<svelte:head>
  <link
    rel="shortcut icon"
    type="image/png"
    id="favicon-site"
    href={$activeGames.length > 0 ? "/favicon-active.ico" : "/favicon.ico"}
  />

  {#if $route?.meta?.title}
    <title>{$route.meta.title} - Boardgamers 🌌</title>
  {/if}
</svelte:head>

<div id="app">
  <div id="app-layout">
    <div style="flex-grow: 1; display: flex; flex-direction: column">
      <Appbar class="mb-3" />
      <main class="container-fluid p-relative mb-auto">
        <RouterView />
      </main>
      <Footer />
    </div>
    <Sidebar />
  </div>
</div>

<style lang="postcss">
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

  #app-layout {
    height: 100%;
    display: flex;
    flex-direction: row;
  }
</style>
