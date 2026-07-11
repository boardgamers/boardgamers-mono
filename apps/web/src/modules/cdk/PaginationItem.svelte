<script lang="ts">
  import { classnames } from "@/utils";

  let {
    active = false,
    disabled = false,
    class: className = "",
    children,
    ...rest
  }: {
    active?: boolean;
    disabled?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames("page-item", active ? "active" : "", disabled ? "disabled" : "", className)
  );
</script>

<li class={classes} {...rest}>{@render children?.()}</li>
