<script lang="ts">
  import Spinner from "./Spinner.svelte";

  let {
    loading = false,
  }: {
    loading?: boolean;
  } = $props();
</script>

{#if loading}
  <div class="text-center"><Spinner color="secondary" /></div>
{:else}
  <slot />
{/if}
