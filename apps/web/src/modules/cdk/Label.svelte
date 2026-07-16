<script lang="ts">
  import { classnames } from "@/utils";

  let {
    for: forAttr = undefined,
    hidden = false,
    class: className = "",
    children,
    ...rest
  }: {
    for?: string;
    hidden?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames("block text-sm font-medium mb-1", hidden ? "sr-only" : "", className)
  );
</script>

<label for={forAttr} class={classes} {...rest}>{@render children?.()}</label>
