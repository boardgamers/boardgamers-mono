<script lang="typescript">
	import Appbar from './components/Appbar.svelte';
	import Footer from './components/Footer.svelte';
	import Sidebar from './components/Sidebar.svelte';
  import { RouterView } from './modules/router';
</script>

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
