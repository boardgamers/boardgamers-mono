<script lang="ts">
  import { classnames } from "@/utils";

  export let value: string = "";
  export let checked: boolean = false;
  export let group: string[] | null = null;

  if (value && group?.includes(value)) {
    checked = true;
  }

  let className = "";
  export { className as class };

  const id = "check-" + Math.random().toString().slice(2, 9);

  $: classes = classnames(className, "form-check");

  const onValueChanged = () => {
    if (group && value) {
      if (checked && !group.includes(value)) {
        group = [...group, value];
      } else if (!checked && group.includes(value)) {
        group = group.filter((x) => x !== value);
      }
    }
  };

  $: onValueChanged(), [checked];
</script>

<div class={classes}>
  <input type="checkbox" class="form-check-input" {id} bind:checked on:change on:blur {value} />
  <label class="form-check-label" for={id} style="cursor: pointer"><slot /></label>
</div>
