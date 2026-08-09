<script lang="ts">
	import type { PageFront } from "@bgs/models";
	import Page from "@/components/Page.svelte";
	import { SEO } from "@/components";
	import { stripMarkdown, truncate } from "@/lib/seo";

	let { data }: { data: { pageContent: Partial<PageFront> } } = $props();
</script>

<SEO
	title={data.pageContent.title}
	description={truncate(stripMarkdown(`${data.pageContent.content ?? ""}`), 200)}
	type="article"
/>

<Page pageContent={data.pageContent} />
