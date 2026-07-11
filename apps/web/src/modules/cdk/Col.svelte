<script lang="ts">
  import { classnames } from "@/utils";

  let {
    xs = "",
    sm = "",
    md = "",
    lg = "",
    xl = "",
    class: className = "",
    children,
    ...rest
  }: {
    xs?: string | number;
    sm?: string | number;
    md?: string | number;
    lg?: string | number;
    xl?: string | number;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  function colClass(prefix: string, value: string | number): string {
    if (value === "" || value === undefined || value === null) return "";
    if (value === true || value === "true") return `col-${prefix}`;
    return `col-${prefix}-${value}`;
  }

  let classes = $derived(
    classnames(
      "col",
      colClass("", xs),
      colClass("sm", sm),
      colClass("md", md),
      colClass("lg", lg),
      colClass("xl", xl),
      className
    )
  );
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
