<script lang="ts">
	import { resolve } from "$app/paths";
	import SanitizedHtml from "@/components/SanitizedHtml.svelte";
	import marked from "marked";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

	function formatDate(iso: string | undefined): string {
		return iso ? dateFormat.format(new Date(iso)) : "";
	}

	// The "older entries" cursor is the createdAt of the oldest entry on the page.
	let nextBefore = $derived(data.entries.at(-1)?.createdAt);
	let nextPageHref = $derived(
		nextBefore
			? `${resolve("/(app)/changelog")}?${new URLSearchParams({ page: String(data.pageNumber + 1), before: nextBefore })}`
			: ""
	);
</script>

<div class="container mx-auto max-w-2xl px-4 py-8">
	<h1 class="mb-6 text-2xl font-bold">Changelog</h1>

	{#if data.entries.length === 0}
		<p class="text-sm text-gray-500 dark:text-gray-400">Nothing here yet.</p>
	{:else}
		<ul class="space-y-6">
			{#each data.entries as entry (entry._id)}
				<li class="border-b border-gray-200 pb-6 last:border-b-0 dark:border-gray-700">
					<div class="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
						<h2 class="text-base font-semibold">{entry.title}</h2>
						<time class="text-xs text-gray-500 dark:text-gray-400" datetime={entry.createdAt ?? ""}>
							{formatDate(entry.createdAt)}
						</time>
					</div>
					<div class="changelog-content prose dark:prose-invert max-w-none text-sm">
						<SanitizedHtml html={marked(entry.content)} />
					</div>
				</li>
			{/each}
		</ul>

		<nav class="mt-6 flex items-center justify-between" aria-label="Changelog pagination">
			{#if data.pageNumber > 1}
				<a
					href={resolve("/(app)/changelog")}
					class="text-sm font-medium text-accent hover:underline dark:text-accent-lighter"
					data-sveltekit-preload-data="hover">← Newer entries</a
				>
			{:else}
				<span></span>
			{/if}
			{#if data.hasMore && nextBefore}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- nextPageHref is built from resolve() above; the rule can't trace $derived state, and its next-line report range spans the whole multi-line tag -->
				<a
					href={nextPageHref}
					class="text-sm font-medium text-accent hover:underline dark:text-accent-lighter"
					data-sveltekit-preload-data="hover"
				>
					Older entries →
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</nav>
	{/if}
</div>

<style>
	.changelog-content :global(p) {
		margin-bottom: 0.5rem;
	}
</style>
