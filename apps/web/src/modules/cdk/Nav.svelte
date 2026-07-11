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
      navbar ? "navbar-nav" : "nav",
      pills ? "nav-pills" : "",
      tabs ? "nav-tabs" : "",
      vertical ? "flex-column" : "",
      className
    )
  );
</script>

<ul class={classes} {...rest}>{@render children?.()}</ul>
