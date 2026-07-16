<script lang="ts">
  import { getContext, setContext } from "svelte";
  import type { Snippet } from "svelte";
  import { route } from "./router";

  const key = "router-context-key";

  let { children }: { children?: Snippet } = $props();

  let n = getContext<number>(key) ?? 0;
  setContext(key, n + 1);
</script>

{#if $route && $route.component}
  {@const Component = $route.layout && n === 0 ? $route.layout : $route.component}
  <Component {...($route.props ? $route.props($route) : $route.params)} />
{:else}
  <div>{@render children?.()}</div>
{/if}
