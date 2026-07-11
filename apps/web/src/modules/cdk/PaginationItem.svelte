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
    classnames(
      active ? "bg-primary text-white" : "",
      disabled ? "opacity-50 pointer-events-none" : "",
      className
    )
  );
</script>

<li class={classes} {...rest}>{@render children?.()}</li>
