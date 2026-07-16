<script lang="ts">
  import { classnames } from "@/utils";

  let {
    xs = "",
    sm = "",
    md = "",
    lg = "",
    xl = "",
    class: className = "",
    children,
    ...rest
  }: {
    xs?: string | number;
    sm?: string | number;
    md?: string | number;
    lg?: string | number;
    xl?: string | number;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  // Tailwind has no 12-column grid utilities matching Bootstrap's `col-<bp>-<n>`.
  // Use flex-1 grow with responsive variants; numeric widths fall back to a
  // grow class since arbitrary fractional flex-basis values aren't standardized.
  function colClass(prefix: string, value: string | number): string {
    if (value === "" || value === undefined || value === null) return "";
    const bp = prefix ? `${prefix}:` : "";
    return `${bp}flex-1`;
  }

  let classes = $derived(
    classnames(
      "flex-1",
      colClass("", xs),
      colClass("sm", sm),
      colClass("md", md),
      colClass("lg", lg),
      colClass("xl", xl),
      className
    )
  );
</script>

<div class={classes} {...rest}>{@render children?.()}</div>
