<script lang="ts">
	import type { PageFront } from "@bgs/models";
	import Page from "@/components/Page.svelte";

	let { data }: { data: { pageContent: Partial<PageFront> } } = $props();
</script>

<Page pageContent={data.pageContent} />
