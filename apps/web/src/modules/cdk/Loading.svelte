<script lang="ts">
  import Spinner from "./Spinner.svelte";
  import type { Snippet } from "svelte";

  let {
    loading = false,
    children,
  }: {
    loading?: boolean;
    children?: Snippet;
  } = $props();
</script>

{#if loading}
  <div class="text-center"><Spinner color="secondary" /></div>
{:else}
  {@render children?.()}
{/if}
