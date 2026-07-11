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
      "list-group",
      flush ? "list-group-flush" : "",
      horizontal ? "list-group-horizontal" : "",
      className
    )
  );
</script>

<ul class={classes} {...rest}>{@render children?.()}</ul>
