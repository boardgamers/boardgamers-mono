<script lang="ts">
  import { route } from "./router";
</script>

{#if $route && $route.component}
  <svelte:component this={$route.component} {...$route.params} />
{:else}
  <div><slot /></div>
{/if}
