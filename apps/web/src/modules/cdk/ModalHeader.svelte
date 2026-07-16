<script lang="ts">
  import { classnames } from "@/utils";

  let {
    toggle = undefined,
    class: className = "",
    children,
    ...rest
  }: {
    toggle?: () => void;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames("flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700", className)
  );
</script>

<div class={classes} {...rest}>
  {@render children?.()}
  {#if toggle}
    <button
      type="button"
      class="ml-auto inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
      aria-label="Close"
      onclick={toggle}
    >
      <span class="text-xl leading-none">&times;</span>
    </button>
  {/if}
</div>
