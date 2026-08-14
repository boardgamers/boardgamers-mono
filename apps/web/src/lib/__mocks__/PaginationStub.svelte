<!-- Test stub for Pagination: the real one spreads `...rest` on nested leaf
     $props() (PaginationItem/PaginationLink), which crashes in the jsdom/svelte
     vitest env. This stub keeps currentPage two-way bound and renders a "Go to
     page N" button per page (plus prev/next) so specs can drive pagination. -->
<script lang="ts">
	import { classnames } from "@/utils";

	let {
		align = undefined,
		title = "Pagination",
		count = 0,
		perPage = 10,
		currentPage = $bindable(0),
		boardgameId = undefined,
		class: className = "",
	}: {
		align?: "right" | "left" | "center";
		title?: string;
		count?: number;
		perPage?: number;
		currentPage?: number;
		boardgameId?: string;
		class?: string;
	} = $props();

	let totalPages = $derived(Math.max(1, Math.ceil(count / perPage)));
	let pages = $derived(Array.from({ length: totalPages }, (_, i) => i));
	let classes = $derived(classnames("pagination-stub flex items-center gap-1", className));
</script>

<ul class={classes} aria-label={title}>
	<button aria-label="previous page" disabled={currentPage === 0} onclick={() => (currentPage -= 1)}>‹</button>
	{#each pages as page (page)}
		<button
			aria-label={`Go to page ${page + 1}`}
			class:active={page === currentPage}
			onclick={() => (currentPage = page)}
		>
			{page + 1}
		</button>
	{/each}
	<button aria-label="next page" disabled={currentPage === totalPages - 1} onclick={() => (currentPage += 1)}>
		›
	</button>
</ul>
