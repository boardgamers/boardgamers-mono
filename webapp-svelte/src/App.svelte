<div class="App">
	<header class="App-header">
		<div>
			{@html announcement}
		</div>
		<p>
		<br/>
		<a class="App-link" href="https://svelte.dev" target="_blank" rel="noopener noreferrer">
			Learn Svelte
		</a>
		</p>
	</header>
</div>

<script lang='typescript'>

import {onMount} from 'svelte';
let count: number = 0;
let announcement: string = "";

onMount(() => {
	const interval = setInterval(() => count++, 1000);
	fetch('/api/site/announcement').then(response => response.text()).then(ann => announcement = ann)

	return () => {
		clearInterval(interval);
	};
	
});

</script>
  
<style>

:global(body) {
	margin: 0;
	font-family: Arial, Helvetica, sans-serif;
}
.App {
	text-align: center;
}
.App code {
	background: #0002;
	padding: 4px 8px;
	border-radius: 4px;
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
  
  