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

  let classes = $derived(
    classnames(
      nav ? "nav-link dropdown-toggle" : "btn",
      nav ? "" : color ? `btn-${color}` : "btn-secondary",
      caret ? "dropdown-toggle" : "",
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
