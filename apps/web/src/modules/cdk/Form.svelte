<script lang="ts">
  import { classnames } from "@/utils";

  let {
    class: className = "",
    children,
    onsubmit,
    ...rest
  }: {
    class?: string;
    children?: import("svelte").Snippet;
    onsubmit?: (e: SubmitEvent) => void;
    [key: string]: any;
  } = $props();

  let classes = $derived(classnames(className));
</script>

<form class={classes} onsubmit={onsubmit} {...rest}>{@render children?.()}</form>
