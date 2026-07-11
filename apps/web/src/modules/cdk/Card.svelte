<script lang="ts">
  import { classnames } from "@/utils";

  let {
    header = "",
    class: className = "",
    onclick,
    ...rest
  }: {
    header?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    [key: string]: any;
  } = $props();

  let classes = $derived(classnames("card", className));
</script>

<div class={classes} {onclick} {...rest}>
  {#if header}
    <div class="card-header">{header}</div>
  {/if}
  <div class="card-body">
    <slot />
  </div>
  {#if $$slots?.footer}
    <div class="card-footer">
      <slot name="footer" />
    </div>
  {/if}
</div>
