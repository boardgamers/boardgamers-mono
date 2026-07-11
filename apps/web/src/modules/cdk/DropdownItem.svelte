<script lang="ts">
  import { classnames } from "@/utils";

  let {
    href = "#",
    disabled = false,
    class: className = "",
    children,
    onclick,
    ...rest
  }: {
    href?: string;
    disabled?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames(
      "block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer",
      disabled ? "opacity-50 pointer-events-none" : "",
      className
    )
  );

  function handleClick(e: MouseEvent) {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onclick?.(e);
  }
</script>

<a {href} class={classes} aria-disabled={disabled || undefined} onclick={handleClick} {...rest}>
  {@render children?.()}
</a>
