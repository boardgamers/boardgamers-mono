<script lang="ts">
  import type { PageFront } from "@bgs/models";
  import marked from "marked";

  let { pageContent }: { pageContent: Partial<PageFront> } = $props();
</script>

<svelte:head>
  <title>{pageContent.title}</title>
</svelte:head>

<article class="container mx-auto px-4 prose dark:prose-invert max-w-none">
  <h1>{pageContent.title}</h1>
  <div>
    {@html marked(pageContent.content ?? "")}
  </div>
</article>
