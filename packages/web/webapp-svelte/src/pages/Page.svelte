<script lang="ts">
import { defer } from "@/utils";
import type { Page as IPage } from "@lib/page";
import marked from "marked";
import Loading from "@/modules/cdk/Loading.svelte";
import { get } from "@/api";

let loading = true;
let pageContent: Partial<IPage> = {
  content: "",
  title: "",
}

export let page: string;

const loadPage = defer(async (page: string) => {
  loading = true;
  pageContent = await get(`/page/${page}`);
}, () => loading = false)

$: loadPage(page);
</script>

<svelte:head>
  {#if !loading}
    <title>{pageContent.title} - Boardgamers 🌌</title>
  {/if}
</svelte:head>

<div class="page container">
  <Loading {loading}>
    <h1>{pageContent.title}</h1>
    <div>
      {@html marked(pageContent.content)}
    </div>
  </Loading>
</div>

<style global>
  .page pre {
    background: #eee;
    padding: 10px;
    border-radius: 4px;
  }
</style>
