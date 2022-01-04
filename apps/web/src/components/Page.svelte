<script lang="ts">
  import type { Page as IPage } from "@bgs/types";
  import marked from "marked";

  export let pageContent: Partial<IPage>;
</script>

<svelte:head>
  <title>{pageContent.title}</title>
</svelte:head>

<article class="page container">
  <h1>{pageContent.title}</h1>
  <div>
    {@html marked(pageContent.content ?? "")}
  </div>
</article>

<style global>
  .page pre {
    background: #eee;
    padding: 10px;
    border-radius: 4px;
  }

  .page table {
    border-collapse: collapse;
    margin-top: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .page th,
  .page td {
    border: 1px solid rgba(0, 0, 0, 0.1);
    padding: 5px 14px 5px 12px;
    height: 32px;
  }

  .page th {
    background-color: #555;
    font-weight: 300;
    color: #fff;
    padding-top: 6px;
  }
</style>
