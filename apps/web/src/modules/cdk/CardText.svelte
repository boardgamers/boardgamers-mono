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

  let classes = $derived(classnames("text-sm text-gray-600 dark:text-gray-300", className));
</script>

<div class={classes} {...rest}>
  {@render children?.()}
</div>
