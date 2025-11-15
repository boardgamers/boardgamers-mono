<script lang="ts">
  import { classnames } from "$lib/utils/classname";
  import type { Snippet } from "svelte";

  let {
    class: className = "",
    value = "",
    checked = $bindable(false),
    group = $bindable<string[] | null>(null),
    onchange = $bindable<((event: Event) => void) | null>(null),
    onblur = $bindable<((event: FocusEvent) => void) | null>(null),
    children,
  }: {
    class?: string;
    value?: string;
    checked?: boolean;
    group?: string[] | null;
    style?: string;
    onchange?: ((event: Event) => void) | null;
    onblur?: ((event: FocusEvent) => void) | null;
    children?: Snippet;
  } = $props();

  if (value && group?.includes(value)) {
    checked = true;
  }

  const id = "check-" + Math.random().toString().slice(2, 9);

  const classes = $derived(classnames(className, "form-check"));

  $effect(() => {
    if (group && value) {
      if (checked && !group.includes(value)) {
        group = [...group, value];
      } else if (!checked && group.includes(value)) {
        group = group.filter((x) => x !== value);
      }
    }
  });
</script>

<div class={classes}>
  <input type="checkbox" class="form-check-input" {id} bind:checked {onchange} {onblur} {value} />
  <label class="form-check-label" for={id} style="cursor: pointer">{@render children?.()}</label>
</div>
