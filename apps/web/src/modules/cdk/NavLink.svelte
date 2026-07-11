<script lang="ts">
  import { classnames } from "@/utils";

  let {
    active = false,
    disabled = false,
    href = "#",
    class: className = "",
    children,
    onclick,
    ...rest
  }: {
    active?: boolean;
    disabled?: boolean;
    href?: string;
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames("nav-link", active ? "active" : "", disabled ? "disabled" : "", className)
  );
</script>

<a {href} class={classes} aria-disabled={disabled || undefined} {onclick} {...rest}>
  {@render children?.()}
</a>
