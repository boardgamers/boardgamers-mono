<script lang="typescript">
	import {onMount} from 'svelte';
  import { get } from "@/api";
	
	let announcement: string = "";

	onMount(() => {
		get('/site/announcement').then(ann => announcement = ann)	
	});
</script>

<div class="text-center container">
  <p class="lead py-2 mt-4">
    {@html announcement}
  </p>
</div>

<style>
  .lead {
    font-size: 1.25rem;
    font-weight: 300;
  }
</style>
