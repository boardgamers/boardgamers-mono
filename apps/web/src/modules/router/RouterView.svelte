<script lang="ts">
  import { getContext, setContext } from "svelte";
  import { route } from "./router";

  const key = "router-context-key";

  let n = getContext<number>(key) ?? 0;
  setContext(key, n + 1);
</script>

{#if $route && $route.component}
  <svelte:component
    this={$route.layout && n === 0 ? $route.layout : $route.component}
    {...$route.props ? $route.props($route) : $route.params}
  />
{:else}
  <div><slot /></div>
{/if}
