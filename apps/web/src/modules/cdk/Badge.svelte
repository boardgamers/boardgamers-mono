<script lang="ts">
  import { classnames } from "@/utils";

  let {
    color = "secondary",
    pill = false,
    class: className = "",
    children,
    ...rest
  }: {
    color?: string;
    pill?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames("badge", `bg-${color}`, pill ? "rounded-pill" : "", className)
  );
</script>

<span class={classes} {...rest}>{@render children?.()}</span>
