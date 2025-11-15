<script lang="ts">
  import { Spinner } from "@sveltestrap/sveltestrap";
  import type { Snippet } from "svelte";

  let { loading = $bindable(false), children }: { loading?: boolean; children?: Snippet; style?: string } = $props();
</script>

{#if loading}
  <div class="text-center"><Spinner color="secondary" /></div>
{:else}
  {@render children?.()}
{/if}
