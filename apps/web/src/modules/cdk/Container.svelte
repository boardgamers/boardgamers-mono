<script lang="ts">
  import { classnames } from "@/utils";

  let {
    fluid = false,
    class: className = "",
    children,
    ...rest
  }: {
    fluid?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(classnames(fluid ? "container-fluid" : "container", className));
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
