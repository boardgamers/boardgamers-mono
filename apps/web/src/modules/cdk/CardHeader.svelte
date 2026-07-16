<script lang="ts">
  import { classnames } from "@/utils";

  let {
    class: className = "",
    children,
    ...rest
  }: {
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames("px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-center", className)
  );
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
