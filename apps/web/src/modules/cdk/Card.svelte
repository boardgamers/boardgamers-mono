<script lang="ts">
  import { classnames } from "@/utils";
  import type { Snippet } from "svelte";

  let {
    header = "",
    class: className = "",
    onclick,
    footer,
    children,
    ...rest
  }: {
    header?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    footer?: Snippet;
    children?: Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames("rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800", className)
  );
</script>

<div class={classes} {onclick} {...rest}>
  {#if header}
    <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-semibold text-center">{header}</div>
  {/if}
  <div class="p-4">
    {@render children?.()}
  </div>
  {#if footer}
    <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-center">
      {@render footer?.()}
    </div>
  {/if}
</div>
