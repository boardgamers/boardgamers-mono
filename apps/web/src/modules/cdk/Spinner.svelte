<script lang="ts">
  import { classnames } from "@/utils";

  let {
    color = "",
    size = "",
    class: className = "",
    type = "border",
    children,
    ...rest
  }: {
    color?: string;
    size?: "sm" | "lg" | "";
    class?: string;
    type?: "border" | "grow";
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  const colorClass: Record<string, string> = {
    primary: "text-primary",
    accent: "text-accent",
    secondary: "text-gray-500 dark:text-gray-400",
    success: "text-green-600",
    warning: "text-yellow-500",
    danger: "text-red-600",
    light: "text-white",
    dark: "text-gray-900 dark:text-gray-100",
  };

  const sizeClass: Record<string, string> = {
    sm: "h-4 w-4",
    lg: "h-12 w-12",
  };

  let classes = $derived(
    classnames(
      type === "grow"
        ? "inline-block bg-current rounded-full opacity-75 animate-pulse"
        : "animate-spin rounded-full border-2 border-current border-t-transparent",
      color ? colorClass[color] ?? "" : "",
      size ? sizeClass[size] : type === "border" ? "h-8 w-8" : "",
      className
    )
  );
</script>

<div class={classes} role="status" {...rest}>
  {@render children?.()}
</div>
