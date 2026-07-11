<script lang="ts">
  import { classnames } from "@/utils";

  let {
    color = "",
    size = "",
    class: className = "",
    type = "border",
    children,
    ...rest
  }: {
    color?: string;
    size?: "sm" | "lg" | "";
    class?: string;
    type?: "border" | "grow";
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  let classes = $derived(
    classnames(
      type === "grow" ? "spinner-grow" : "spinner-border",
      color ? `text-${color}` : "",
      size ? `spinner-border-${size}` : "",
      className
    )
  );
</script>

<div class={classes} role="status" {...rest}>
  {@render children?.()}
</div>
