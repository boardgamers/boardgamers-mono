<script lang="ts" context="module">
  import type { LoadInput } from "@sveltejs/kit";

  export async function load(input: LoadInput) {
    const { get } = useLoad(input, useRest);

    const parts = [input.params.part1, input.params.part2].filter(Boolean);

    return {
      props: {
        pageContent: await get(`/page/${parts.join(":")}`),
      },
    };
  }
</script>

<script lang="ts">
  import Page from "$lib/components/Page.svelte";
  import { useLoad } from "$lib/composition/useLoad";
  import { useRest } from "$lib/composition/useRest";
  import { SEO } from "@/components";
  import type { Page as IPage } from "@bgs/types";
  import removeMarkdown from "remove-markdown";

  export let pageContent: Partial<IPage>;
</script>

<SEO
  title={pageContent.title}
  description={removeMarkdown(`${pageContent.content}`.match(/((\s*\S+){0,40})([\s\S]*)/)[1]) + "..."}
/>

<Page {pageContent} />
