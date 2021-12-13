<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const { loadAccount, loadActiveGames } = useLoad(input, useAccount, useActiveGames, useWebsocket);

    await loadAccount();
    await loadActiveGames();

    return {};
  }
</script>

<script lang="ts">
  // todo: check if imports can be all done within style.css
  import "bootstrap-icons/font/bootstrap-icons.css";
  import "bootstrap/dist/css/bootstrap.min.css";
  import "../../style.css";

  import { Appbar, Footer, Sidebar } from "@/components";
  import { useActiveGames } from "@/composition/useActiveGames";
  const { activeGames } = useActiveGames();
</script>

<svelte:head>
  <link
    rel="shortcut icon"
    type="image/png"
    id="favicon-site"
    href={$activeGames.length > 0 ? "/favicon-active.ico" : "/favicon.ico"}
  />
</svelte:head>

<div id="app">
  <div id="app-layout">
    <div style="flex-grow: 1; display: flex; flex-direction: column">
      <Appbar class="mb-3" />
      <main class="container-fluid p-relative mb-auto">
        <slot />
      </main>
      <Footer />
    </div>
    <Sidebar />
  </div>
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

  #app-layout {
    height: 100%;
    display: flex;
    flex-direction: row;
  }
</style>
