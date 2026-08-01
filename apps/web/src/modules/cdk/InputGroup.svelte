<script lang="ts">
  import { classnames } from "@/utils";

  let {
    size = "",
    class: className = "",
    children,
    ...rest
  }: {
    size?: "sm" | "lg" | "";
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  const sizeClass: Record<string, string> = {
    sm: "text-xs",
    lg: "text-base",
  };

  let classes = $derived(classnames("input-group flex items-stretch", size ? sizeClass[size] : "", className));
</script>

<div class={classes} {...rest}>{@render children?.()}</div>

<style>
  /* Merge adjacent controls into one inset unit (input + button, etc.) */
  .input-group > :global(:not(:first-child)) {
    margin-left: -1px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .input-group > :global(:not(:last-child)) {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .input-group > :global(input),
  .input-group > :global(select),
  .input-group > :global(textarea) {
    flex: 1 1 auto;
    width: 1%;
    min-width: 0;
  }

  /* Inside a merged group the browser's default focus outline draws a rectangle over
     the adjoining control (e.g. the Send button) — suppress it and highlight the
     input's border color instead. */
  .input-group > :global(input:focus),
  .input-group > :global(select:focus),
  .input-group > :global(textarea:focus) {
    outline: none;
    border-color: var(--color-primary-light);
    position: relative;
    z-index: 1;
  }
</style>
