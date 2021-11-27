<script context="module" lang="ts">
  import type { LoadInput } from "@sveltejs/kit";

  export async function load(input: LoadInput) {
    return { props: { page: input.page } };
  }
</script>

<script lang="ts">
  import type { Page } from "@sveltejs/kit";
  import { Appbar, Footer, Sidebar } from "@/components";
  import { activeGames, page as pageStore } from "@/store";

  export let page: Page;

  $: pageStore.set(page);
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
