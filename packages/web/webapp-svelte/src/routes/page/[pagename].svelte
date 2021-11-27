<script lang="ts" context="module">
  import { get } from "@/api";
  import type { LoadInput } from "@sveltejs/kit";

  export async function load(input: LoadInput) {
    return {
      props: {
        pageContent: await get(`/page/${input.page.params.pagename}`),
      },
    };
  }
</script>

<script lang="ts">
  import type { Page as IPage } from "@bgs/types";
  import Page from "@/components/Page.svelte";

  export let pageContent: Partial<IPage>;
</script>

<Page {pageContent} />
