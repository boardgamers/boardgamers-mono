<script lang="ts">
  import { classnames } from "@/utils";

  let {
    pills = false,
    tabs = false,
    vertical = false,
    navbar = false,
    class: className = "",
    children,
    ...rest
  }: {
    pills?: boolean;
    tabs?: boolean;
    vertical?: boolean;
    navbar?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames(
      "flex",
      navbar ? "items-center gap-2" : pills || tabs ? "gap-2" : "flex-col gap-1",
      vertical ? "flex-col" : "",
      tabs ? "border-b border-gray-200 dark:border-gray-700" : "",
      className
    )
  );
</script>

<ul class={classes} {...rest}>{@render children?.()}</ul>
