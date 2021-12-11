<script lang="ts">
  import { Spinner } from "@cdk";

  export let loading: boolean;
</script>

{#if loading}
  <div class="text-center"><Spinner color="secondary" /></div>
{:else}
  <slot />
{/if}
