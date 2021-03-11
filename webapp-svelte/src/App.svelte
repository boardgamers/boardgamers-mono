<script lang="typescript">
	import {onMount} from 'svelte';
	import Appbar from './components/Appbar.svelte';
  import { get } from "@/api";
	
	let announcement: string = "";

	onMount(() => {
		get('/site/announcement').then(ann => announcement = ann)	
	});
</script>

<Appbar />

<div class="App">
  <header class="App-header">
    <div>
      {@html announcement}
    </div>
    <p>
      <br />
      <a class="App-link" href="https://svelte.dev" target="_blank" rel="noopener noreferrer"> Learn Svelte </a>
    </p>
  </header>
</div>

<style lang="postcss">
  :global(body) {
    margin: 0;
    font-family: Arial, Helvetica, sans-serif;
  }

  .App {
    text-align: center;
  }

  .App p {
    margin: 0.4rem;
  }

  .App-header {
    background-color: #f9f6f6;
    color: #333;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: calc(10px + 2vmin);
  }
  .App-link {
    color: #ff3e00;
  }
</style>
