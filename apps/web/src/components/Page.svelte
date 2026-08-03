<script lang="ts" context="module">
	// Minimal github-slugger (lowercase, spaces→hyphens, dedupe) for heading anchors.
	class GithubSlugger {
		private seen = new Map<string, number>();
		reset() {
			this.seen.clear();
		}
		slug(value: string): string {
			let slug = value
				.toLowerCase()
				.trim()
				.replace(/[^\w\s-]/g, "")
				.replace(/[\s_]+/g, "-");
			const count = this.seen.get(slug) ?? 0;
			this.seen.set(slug, count + 1);
			return count > 0 ? `${slug}-${count}` : slug;
		}
	}
</script>

<script lang="ts">
	import type { PageFront } from "@bgs/models";
	import marked from "marked";

	let { pageContent }: { pageContent: Partial<PageFront> } = $props();

	const content = $derived(pageContent.content ?? "");
	const html = $derived(marked(content));

	type Heading = { depth: number; text: string; slug: string };
	const slugger = new GithubSlugger();
	const headings = $derived.by<Heading[]>(() => {
		slugger.reset();
		return content
			.split("\n")
			.map((line) => /^(#{1,3})\s+(.*)/.exec(line))
			.filter((m): m is RegExpExecArray => !!m)
			.map((m) => {
				const text = m[2].replace(/[*_`\[\]]/g, "").trim();
				return { depth: m[1].length, text, slug: slugger.slug(text) };
			});
	});

	// Re-render with heading ids so the TOC can anchor to sections.
	const htmlWithIds = $derived.by(() => {
		slugger.reset();
		return html.replace(/<h([1-3])>(.*?)<\/h\1>/g, (_m, depth, inner) => {
			const text = inner.replace(/<[^>]+>/g, "").trim();
			return `<h${depth} id="${slugger.slug(text)}">${inner}</h${depth}>`;
		});
	});
</script>

<svelte:head>
	<title>{pageContent.title}</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-6xl gap-8 px-4 py-8">
	{#if headings.length > 2}
		<nav class="sticky top-4 hidden h-fit w-56 shrink-0 self-start lg:block" aria-label="Table of contents">
			<div class="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
				{pageContent.title}
			</div>
			<ul class="space-y-1 border-s border-gray-200 text-sm dark:border-gray-700">
				{#each headings as h}
					<li style:padding-inline-start="{(h.depth - 1) * 0.75}rem">
						<a
							href="#{h.slug}"
							class="block border-s-2 border-transparent px-2 py-0.5 text-gray-600 no-link hover:border-accent hover:text-accent dark:text-gray-400 dark:hover:text-accent-lighter"
						>
							{h.text}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}

	<article class="prose dark:prose-invert lg:prose-lg min-w-0 max-w-3xl page-article">
		<h1>{pageContent.title}</h1>
		<div>
			{@html htmlWithIds}
		</div>
	</article>
</div>

<style>
	.page-article :global(img),
	.page-article :global(video),
	.page-article :global(iframe) {
		max-width: 100%;
		border-radius: 0.5rem;
	}
	/* offset anchored headings below the fixed app bar */
	.page-article :global(h1),
	.page-article :global(h2),
	.page-article :global(h3) {
		scroll-margin-top: 4.5rem;
	}
</style>
