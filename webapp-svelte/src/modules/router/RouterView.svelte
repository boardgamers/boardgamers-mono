<script lang="ts">
  import { route } from "./router";
</script>

{#if $route && $route.component}
  <svelte:component this={$route.component} {...$route.props ? $route.props($route) : $route.params} />
{:else}
  <div><slot /></div>
{/if}
