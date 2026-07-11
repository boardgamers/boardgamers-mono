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

  let classes = $derived(classnames("modal-footer", className));
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
