<script lang="ts">
  import { classnames } from "@/utils";

  let {
    flush = false,
    horizontal = false,
    class: className = "",
    children,
    ...rest
  }: {
    flush?: boolean;
    horizontal?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames(
      "divide-y divide-gray-200 dark:divide-gray-700",
      horizontal ? "flex flex-row divide-x divide-y-0 divide-gray-200 dark:divide-gray-700" : "",
      flush ? "my-0" : "",
      className
    )
  );
</script>

<ul class={classes} {...rest}>{@render children?.()}</ul>
