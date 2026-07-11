<script lang="ts">
  import { setContext } from "svelte";
  import { classnames } from "@/utils";

  let {
    isOpen = undefined,
    toggle = undefined,
    inNavbar = false,
    group = false,
    nav = false,
    class: className = "",
    children,
    ...rest
  }: {
    isOpen?: boolean;
    toggle?: () => void;
    inNavbar?: boolean;
    group?: boolean;
    nav?: boolean;
    class?: string;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  // Internal state for uncontrolled usage (no isOpen prop passed).
  let internalOpen = $state(false);
  let open = $derived(isOpen !== undefined ? isOpen : internalOpen);

  function doToggle() {
    if (toggle) {
      toggle();
    } else {
      internalOpen = !internalOpen;
    }
  }

  // Share reactive state with DropdownToggle / DropdownMenu via context.
  // The getter makes `isOpen` reactive when read inside a child template.
  setContext("sveltestrap-dropdown", {
    get isOpen() {
      return open;
    },
    toggle: doToggle,
  });

  let classes = $derived(
    classnames(
      group ? "btn-group" : "dropdown",
      nav ? "nav-item dropdown" : "",
      open ? "show" : "",
      className
    )
  );
</script>

<div class={classes} {...rest}>
  {@render children?.()}
</div>
