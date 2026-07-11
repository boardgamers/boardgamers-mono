<script lang="ts">
  import { getContext } from "svelte";
  import { classnames } from "@/utils";

  let {
    nav = false,
    caret = true,
    tag = "button",
    color = "",
    class: className = "",
    children,
    onclick,
    ...rest
  }: {
    nav?: boolean;
    caret?: boolean;
    tag?: string;
    color?: string;
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  } = $props();

  const dropdown = getContext<{ isOpen: boolean; toggle: () => void }>("sveltestrap-dropdown");

  function handleClick(e: MouseEvent) {
    onclick?.(e);
    dropdown?.toggle();
  }

  const solid: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary-light",
    accent: "bg-accent text-white hover:bg-accent-light",
    secondary:
      "bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
    success: "bg-green-600 text-white hover:bg-green-700",
    warning: "bg-yellow-500 text-white hover:bg-yellow-600",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };

  const btnBase =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors";

  let classes = $derived(
    classnames(
      nav
        ? "px-3 py-2 rounded-md hover:bg-white/10 cursor-pointer"
        : classnames(btnBase, color ? (solid[color] ?? solid.secondary) : solid.secondary),
      caret ? "after:content-['▾'] after:ml-1 after:text-xs" : "",
      className
    )
  );
</script>

{#if nav}
  <button
    type="button"
    class={classes}
    aria-haspopup="true"
    aria-expanded={dropdown?.isOpen}
    onclick={handleClick}
    {...rest}
  >
    {@render children?.()}
  </button>
{:else if tag === "div"}
  <div class={classes} onclick={handleClick} {...rest}>
    {@render children?.()}
  </div>
{:else}
  <button type="button" class={classes} aria-haspopup="true" aria-expanded={dropdown?.isOpen} onclick={handleClick} {...rest}>
    {@render children?.()}
  </button>
{/if}
