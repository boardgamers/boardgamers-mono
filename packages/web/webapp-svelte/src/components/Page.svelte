<script lang="ts">
  import type { Page as IPage } from "@bgs/types";
  import marked from "marked";

  export let pageContent: Partial<IPage>;
</script>

<svelte:head>
  <title>{pageContent.title} - Boardgamers 🌌</title>
</svelte:head>

<div class="page container">
  <h1>{pageContent.title}</h1>
  <div>
    {@html marked(pageContent.content ?? "")}
  </div>
</div>

<style global>
  .page pre {
    background: #eee;
    padding: 10px;
    border-radius: 4px;
  }
</style>
