<script lang="ts">
  import { classnames } from "@/utils";

  let {
    color = "secondary",
    outline = false,
    size = "",
    block = false,
    disabled = false,
    href,
    type = "button",
    class: className = "",
    children,
    onclick,
    ...rest
  }: {
    color?: string;
    outline?: boolean;
    size?: "sm" | "lg" | "";
    block?: boolean;
    disabled?: boolean;
    href?: string;
    type?: "button" | "submit" | "reset";
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  } = $props();

  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

  const solid: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary-light",
    accent: "bg-accent text-white hover:bg-accent-light",
    secondary:
      "bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
    success: "bg-green-600 text-white hover:bg-green-700",
    warning: "bg-yellow-500 text-white hover:bg-yellow-600",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };

  const outlineClasses: Record<string, string> = {
    primary: "border border-primary text-primary hover:bg-primary hover:text-white",
    accent: "border border-accent text-accent hover:bg-accent hover:text-white",
    secondary:
      "border border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700",
    success: "border border-green-600 text-green-600 hover:bg-green-600 hover:text-white",
    warning: "border border-yellow-500 text-yellow-600 hover:bg-yellow-500 hover:text-white",
    danger: "border border-red-600 text-red-600 hover:bg-red-600 hover:text-white",
  };

  const sizeClasses: Record<string, string> = {
    sm: "px-2 py-1 text-xs",
    lg: "px-5 py-2.5 text-base",
  };

  let classes = $derived(
    classnames(
      base,
      outline ? (outlineClasses[color] ?? outlineClasses.secondary) : (solid[color] ?? solid.secondary),
      size ? sizeClasses[size] : "",
      block ? "block w-full" : "",
      disabled ? "opacity-50 pointer-events-none" : "",
      className
    )
  );

  let tag = $derived(href ? "a" : "button");
</script>

{#if tag === "a"}
  <a {href} class={classes} role="button" aria-disabled={disabled} {onclick} {...rest}>
    {@render children?.()}
  </a>
{:else}
  <button {type} class={classes} {disabled} {onclick} {...rest}>
    {@render children?.()}
  </button>
{/if}
