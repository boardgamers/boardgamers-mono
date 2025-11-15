<!-- Same as sveltestrap but with div instead of p -->
<script lang="ts">
  import { classnames } from "$lib/utils/classname";
  import type { Snippet } from "svelte";

  let {
    class: className = "",
    children,
    ...restProps
  }: { class?: string; style?: string; children?: Snippet } = $props();

  const classes = $derived(classnames(className, "card-text"));
</script>

<div {...restProps} class={classes}>
  {@render children?.()}
</div>
