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

  let classes = $derived(classnames("modal-header", className));
</script>

<div class={classes} {...rest}>
  {@render children?.()}
  {#if toggle}
    <button type="button" class="btn-close" aria-label="Close" onclick={toggle} />
  {/if}
</div>
