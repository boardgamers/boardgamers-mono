<!-- card-text rendered as a div instead of a p -->
<script lang="ts">
  import { classnames } from "@/utils";

  let {
    class: className = "",
    ...rest
  }: {
    class?: string;
    [key: string]: any;
  } = $props();

  let classes = $derived(classnames(className, "card-text"));
</script>

<div class={classes} {...rest}>
  <slot />
</div>
