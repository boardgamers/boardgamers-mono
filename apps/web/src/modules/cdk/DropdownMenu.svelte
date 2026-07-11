<script lang="ts">
  import { getContext } from "svelte";
  import { classnames } from "@/utils";

  let {
    right = false,
    class: className = "",
    children,
    ...rest
  }: {
    right?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  const dropdown = getContext<{ isOpen: boolean; toggle: () => void }>("sveltestrap-dropdown");

  let classes = $derived(
    classnames(
      "absolute mt-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg z-50 min-w-[200px]",
      right ? "left-0" : "right-0",
      dropdown?.isOpen ? "block" : "hidden",
      className
    )
  );
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
