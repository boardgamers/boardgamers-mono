<script lang="ts">
import { Spinner } from "sveltestrap";

export let loading: boolean
</script>

{#if loading}
  <p class="text-center"><Spinner color="secondary" /></p>
{:else}
  <slot />
{/if}
