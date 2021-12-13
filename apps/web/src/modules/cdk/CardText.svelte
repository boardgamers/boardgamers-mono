<!-- Same as sveltestrap but with div instead of p -->
<script lang="ts">
  import { classnames } from "@/utils";

  let className = "";
  export { className as class };

  $: classes = classnames(className, "card-text");
</script>

<div {...$$restProps} class={classes}>
  <slot />
</div>
