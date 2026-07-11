<script lang="ts">
  import { classnames } from "@/utils";

  let {
    href = "#",
    first = false,
    previous = false,
    next = false,
    last = false,
    arialabel = undefined,
    class: className = "",
    children,
    onclick,
    ...rest
  }: {
    href?: string;
    first?: boolean;
    previous?: boolean;
    next?: boolean;
    last?: boolean;
    arialabel?: string;
    class?: string;
    children?: import("svelte").Snippet;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames(
      "inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-md text-sm hover:bg-gray-100 dark:hover:bg-gray-700",
      className
    )
  );

  // Pagination uses these glyphs for first/prev/next/last.
  let defaultContent = $derived(
    first ? "«" : previous ? "‹" : next ? "›" : last ? "»" : undefined
  );
</script>

<a
  {href}
  class={classes}
  aria-label={arialabel}
  {onclick}
  {...rest}
>
  {@render children?.()}
  {#if defaultContent !== undefined && !children}{defaultContent}{/if}
</a>
