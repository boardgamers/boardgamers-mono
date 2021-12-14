<script lang="ts" context="module">
  import type { LoadInput } from "@sveltejs/kit";

  export async function load(input: LoadInput) {
    const { get } = useLoad(input, useRest);

    const parts = [input.page.params.part1, input.page.params.part2].filter(Boolean);

    return {
      props: {
        pageContent: await get(`/page/${parts.join(":")}`),
      },
    };
  }
</script>

<script lang="ts">
  import type { Page as IPage } from "@bgs/types";
  import Page from "@/components/Page.svelte";
  import { useLoad } from "@/composition/useLoad";
  import { useRest } from "@/composition/useRest";
  import { SEO } from "@/components";
  import removeMarkdown from "remove-markdown";

  export let pageContent: Partial<IPage>;
</script>

<SEO
  title={pageContent.title}
  description={removeMarkdown(`${pageContent.content}`.match(/((\s*\S+){0,40})([\s\S]*)/)[1]) + "..."}
/>

<Page {pageContent} />
