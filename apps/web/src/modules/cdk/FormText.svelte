<script lang="ts">
  import { classnames } from "@/utils";

  let {
    class: className = "",
    children,
    ...rest
  }: {
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(classnames("text-xs text-gray-500 dark:text-gray-400", className));
</script>

<small class={classes} {...rest}>{@render children?.()}</small>
