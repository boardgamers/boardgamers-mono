<!-- card-text rendered as a div instead of a p -->
<script lang="ts">
  import { classnames } from "@/utils";
  import type { Snippet } from "svelte";

  let {
    class: className = "",
    children,
    ...rest
  }: {
    class?: string;
    children?: Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(classnames(className, "card-text"));
</script>

<div class={classes} {...rest}>
  {@render children?.()}
</div>
