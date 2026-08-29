<script lang="ts">
	import { resolve } from "$app/paths";
	import SanitizedHtml from "@/components/SanitizedHtml.svelte";
	import IconGithub from "@/components/icons/IconGithub.svelte";
	import marked from "marked";
	import type { PageProps } from "./$types";
	import { m } from "@/lib/i18n/messages";

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
	<h1 class="mb-6 text-2xl font-bold">{m.changelog_title()}</h1>

	{#if data.entries.length === 0}
		<p class="text-sm text-gray-500 dark:text-gray-400">{m.changelog_empty()}</p>
	{:else}
		<ul class="space-y-6">
			{#each data.entries as entry (entry._id)}
				<li class="border-b border-gray-200 pb-6 last:border-b-0 dark:border-gray-700">
					<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
						<div class="changelog-line prose dark:prose-invert max-w-none min-w-0 text-base font-medium">
							<SanitizedHtml html={marked(entry.content)} />
						</div>
						<div class="flex shrink-0 items-center gap-2">
							{#if entry.github}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- external URL from the entry (target=_blank), resolve() is for internal paths; the rule's report range spans the whole multi-line tag -->
								<a
									href={entry.github}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 hover:underline dark:text-gray-400 dark:hover:text-gray-100"
								>
									<IconGithub size="0.9em" />
									PR
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{/if}
							<time class="text-xs text-gray-500 dark:text-gray-400" datetime={entry.createdAt ?? ""}>
								{formatDate(entry.createdAt)}
							</time>
						</div>
					</div>
					{#if entry.details}
						<div class="changelog-content prose dark:prose-invert mt-2 max-w-none text-sm">
							<SanitizedHtml html={marked(entry.details)} />
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<nav class="mt-6 flex items-center justify-between" aria-label={m.changelog_pagination()}>
			{#if data.pageNumber > 1}
				<a
					href={resolve("/(app)/changelog")}
					class="text-sm font-medium text-accent hover:underline dark:text-accent-lighter"
					data-sveltekit-preload-data="hover">{m.changelog_newer()}</a
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
					{m.changelog_older()}
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
	.changelog-content :global(p:last-child) {
		margin-bottom: 0;
	}
	/* The one-liner renders inline so it sits on a single line with the date. */
	.changelog-line :global(p) {
		margin: 0;
	}
</style>
