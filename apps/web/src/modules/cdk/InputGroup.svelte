<script lang="ts">
  import { classnames } from "@/utils";

  let {
    size = "",
    class: className = "",
    children,
    ...rest
  }: {
    size?: "sm" | "lg" | "";
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames("input-group", size ? `input-group-${size}` : "", className)
  );
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
