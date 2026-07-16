<script lang="ts">
  import { classnames } from "@/utils";

  let {
    checked = $bindable(false),
    group = $bindable(null),
    value = "",
    class: className = "",
    onchange,
    onblur,
    children,
    ...rest
  }: {
    checked?: boolean;
    group?: string[] | null;
    value?: string;
    class?: string;
    onchange?: (e: Event) => void;
    onblur?: (e: Event) => void;
    children?: import("svelte").Snippet;
    [key: string]: any;
  } = $props();

  // If this checkbox's value is part of the group, mark it checked.
  $effect(() => {
    if (value && group?.includes(value)) {
      checked = true;
    }
  });

  let classes = $derived(classnames("flex items-center gap-2", className));

  const id = "check-" + Math.random().toString().slice(2, 9);

  function handleChange(e: Event) {
    const target = e.target as HTMLInputElement;
    checked = target.checked;

    if (group && value) {
      if (checked && !group.includes(value)) {
        group = [...group, value];
      } else if (!checked && group.includes(value)) {
        group = group.filter((x) => x !== value);
      }
    }

    onchange?.(e);
  }
</script>

<div class={classes}>
  <input
    type="checkbox"
    class="h-4 w-4 rounded border-gray-300"
    {id}
    bind:checked
    {value}
    onchange={handleChange}
    onblur={onblur}
    {...rest}
  />
  <label class="text-sm cursor-pointer" for={id}>{@render children?.()}</label>
</div>
