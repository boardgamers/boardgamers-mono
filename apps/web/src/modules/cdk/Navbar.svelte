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

  const bgClass: Record<string, string> = {
    primary: "bg-primary text-white",
    accent: "bg-accent text-white",
    contrast: "bg-contrast text-white",
    light: "bg-gray-100 text-gray-800",
    dark: "bg-gray-800 text-white",
  };

  let classes = $derived(
    classnames(
      "flex items-center justify-between px-4 py-2",
      color ? bgClass[color] ?? "" : "",
      dark && !color ? "bg-gray-800 text-white" : "",
      light && !color ? "bg-gray-100 text-gray-800" : "",
      fixed === "top" ? "fixed top-0 inset-x-0" : fixed === "bottom" ? "fixed bottom-0 inset-x-0" : "",
      sticky === "top" ? "sticky top-0" : "",
      className
    )
  );
</script>

<nav class={classes} {...rest}>{@render children?.()}</nav>
