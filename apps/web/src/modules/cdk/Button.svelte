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

  let classes = $derived(
    classnames(
      "btn",
      outline ? `btn-outline-${color}` : `btn-${color}`,
      size ? `btn-${size}` : "",
      block ? "d-block w-100" : "",
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
