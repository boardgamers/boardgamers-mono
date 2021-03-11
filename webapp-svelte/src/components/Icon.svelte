<script lang="ts">
  import { classnames } from "@/utils";
  import Icon from "sveltestrap/src/Icon.svelte";

  let className = '';
  export { className as class };
  export let name = '';

  $: classes = classnames(className, 'bi');
</script>

<Icon {...$$restProps} class={classes} {name} />

<style lang="postcss" global>
  .bi {
    font-size: 125%;
  }
</style>
