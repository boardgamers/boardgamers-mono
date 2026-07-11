<script lang="ts">
  import { classnames } from "@/utils";

  let {
    color = "",
    dark = false,
    light = false,
    expand = "",
    fixed = "",
    sticky = "",
    class: className = "",
    children,
    ...rest
  }: {
    color?: string;
    dark?: boolean;
    light?: boolean;
    expand?: "" | "sm" | "md" | "lg" | "xl" | boolean;
    fixed?: "" | "top" | "bottom";
    sticky?: "" | "top";
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let expandClass = $derived(
    expand === true ? "navbar-expand" : expand ? `navbar-expand-${expand}` : ""
  );

  let classes = $derived(
    classnames(
      "navbar",
      dark ? "navbar-dark" : "",
      light ? "navbar-light" : "",
      color ? `bg-${color}` : "",
      expandClass,
      fixed ? `fixed-${fixed}` : "",
      sticky ? `sticky-${sticky}` : "",
      className
    )
  );
</script>

<nav class={classes} {...rest}>{@render children?.()}</nav>
