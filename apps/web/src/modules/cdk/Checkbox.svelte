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

  let classes = $derived(classnames(className, "form-check"));

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
    class="form-check-input"
    {id}
    bind:checked
    {value}
    onchange={handleChange}
    onblur={onblur}
    {...rest}
  />
  <label class="form-check-label" for={id} style="cursor: pointer">{@render children?.()}</label>
</div>
