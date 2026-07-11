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

  let classes = $derived(classnames("card", className));
</script>

<div class={classes} {onclick} {...rest}>
  {#if header}
    <div class="card-header">{header}</div>
  {/if}
  <div class="card-body">
    {@render children?.()}
  </div>
  {#if footer}
    <div class="card-footer">
      {@render footer?.()}
    </div>
  {/if}
</div>
