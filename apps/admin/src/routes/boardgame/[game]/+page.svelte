<script lang="ts">
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();
</script>

<div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
	<h2 class="text-lg font-semibold mb-2">Boardgame not found</h2>
	<p class="text-sm text-gray-500 dark:text-gray-400">
		No boardgame with id <span class="font-mono">{data.game}</span> — it has no published version.
	</p>
</div>
