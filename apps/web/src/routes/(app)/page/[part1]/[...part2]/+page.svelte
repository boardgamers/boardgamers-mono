<script lang="ts">
  import type { PageFront } from "@bgs/models";
  import Page from "@/components/Page.svelte";
  import { SEO } from "@/components";
  import removeMarkdown from "remove-markdown";

  let { data }: { data: { pageContent: Partial<PageFront> } } = $props();
</script>

<SEO
  title={data.pageContent.title}
  description={removeMarkdown(`${data.pageContent.content}`.match(/((\s*\S+){0,40})([\s\S]*)/)[1]) + "..."}
/>

<Page pageContent={data.pageContent} />
