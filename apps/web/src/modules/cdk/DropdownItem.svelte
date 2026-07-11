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

  let classes = $derived(classnames("dropdown-item", disabled ? "disabled" : "", className));

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
