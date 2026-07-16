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

  const sizeClass: Record<string, string> = {
    sm: "text-xs",
    lg: "text-base",
  };

  let classes = $derived(
    classnames("flex items-stretch", size ? sizeClass[size] : "", className)
  );
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
