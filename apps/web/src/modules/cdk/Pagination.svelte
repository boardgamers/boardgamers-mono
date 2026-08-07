<script lang="ts">
	import { resolve } from "$app/paths";
	import type { Pathname } from "$app/types";
	import { classnames } from "@/utils";
	import PaginationItem from "./PaginationItem.svelte";
	import PaginationLink from "./PaginationLink.svelte";

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
		/** When set, pages link to /boardgame/[boardgameId]/rankings/[...page] (server-side pagination). */
		boardgameId?: string;
		class?: string;
	} = $props();

	// Should always be odd-numbered
	const pageItems = 5;

	const alignClass: Record<string, string> = {
		right: "justify-end",
		center: "justify-center",
		left: "justify-start",
	};

	let classes = $derived(classnames("flex items-center gap-1", align ? alignClass[align] : "", className));

	let totalPages = $derived(Math.max(1, Math.ceil(count / perPage)));

	function pageFor(position: number): number | string {
		const pos = Math.min(
			Math.max(position, currentPage + (position - (pageItems - 1) / 2)),
			totalPages + position - pageItems
		);

		if (position === pageItems - 1 && (pos as number) + 1 < totalPages) {
			return "…";
		}

		if (position === 0 && pos > 0) {
			return "…";
		}

		return pos;
	}

	// 1-based page number → href: typed rankings route when server-paginating, anchor otherwise.
	function pageHref(pageNumber: number): Pathname {
		if (boardgameId) {
			return resolve("/(app)/boardgame/[boardgameId]/rankings/[...page]", {
				boardgameId,
				page: String(pageNumber),
			}) as Pathname;
		}
		// Non-navigating placeholder (click is intercepted): keep a fragment href.
		return `#${pageNumber}` as Pathname;
	}
</script>

<ul class={classes} aria-label={title}>
	<PaginationItem disabled={currentPage === 0}>
		<PaginationLink
			first
			href={pageHref(1)}
			onclick={(e) => {
				e.preventDefault();
				currentPage = 0;
			}}
		/>
	</PaginationItem>
	<PaginationItem disabled={currentPage === 0}>
		<PaginationLink
			previous
			href={pageHref(currentPage)}
			onclick={(e) => {
				e.preventDefault();
				currentPage -= 1;
			}}
		/>
	</PaginationItem>
	{#each Array(pageItems) as _, position (pageFor(position) + "_" + position)}
		{#if !((pageFor(position) as number) < 0)}
			<PaginationItem disabled={typeof pageFor(position) !== "number"} active={pageFor(position) === currentPage}>
				<PaginationLink
					href={pageHref(+pageFor(position) + 1)}
					onclick={!boardgameId
						? (e) => {
								e.preventDefault();
								currentPage = +pageFor(position);
							}
						: () => {}}
					arialabel={typeof pageFor(position) === "number" ? `Go to page ${+pageFor(position) + 1}` : undefined}
				>
					{typeof pageFor(position) === "number" ? +pageFor(position) + 1 : pageFor(position)}
				</PaginationLink>
			</PaginationItem>
		{/if}
	{/each}
	<PaginationItem disabled={currentPage === totalPages - 1}>
		<PaginationLink
			next
			href={pageHref(currentPage + 2)}
			onclick={(e) => {
				e.preventDefault();
				currentPage += 1;
			}}
		/>
	</PaginationItem>
	<PaginationItem disabled={currentPage === totalPages - 1}>
		<PaginationLink
			last
			href={pageHref(totalPages)}
			onclick={(e) => {
				e.preventDefault();
				currentPage = totalPages - 1;
			}}
		/>
	</PaginationItem>
</ul>
