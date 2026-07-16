<script lang="ts">
  import { classnames } from "@/utils";

  let {
    color = "secondary",
    pill = false,
    class: className = "",
    children,
    ...rest
  }: {
    color?: string;
    pill?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  const base = "badge inline-flex items-center rounded px-2 py-0.5 text-xs font-medium";

  const colorClasses: Record<string, string> = {
    primary: "bg-primary text-white",
    accent: "bg-accent text-white",
    secondary: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
    info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    contrast: "bg-contrast text-white",
    success: "bg-green-600 text-white",
    warning: "bg-yellow-500 text-white",
    danger: "bg-red-600 text-white",
  };

  let classes = $derived(
    classnames(base, colorClasses[color] ?? colorClasses.secondary, pill ? "rounded-full" : "", className)
  );
</script>

<span class={classes} {...rest}>{@render children?.()}</span>
