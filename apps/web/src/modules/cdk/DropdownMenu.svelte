<script lang="ts">
  import { getContext } from "svelte";
  import { classnames } from "@/utils";

  let {
    right = false,
    class: className = "",
    children,
    ...rest
  }: {
    right?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  const dropdown = getContext<{ isOpen: boolean; toggle: () => void }>("sveltestrap-dropdown");

  let classes = $derived(
    classnames("dropdown-menu", dropdown?.isOpen ? "show" : "", right ? "dropdown-menu-end" : "", className)
  );
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
