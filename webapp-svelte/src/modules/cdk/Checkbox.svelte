<script lang="ts">
import { classnames } from "@/utils";


  export let value: boolean;

  let className = '';
  export { className as class };

  const name = "check-" + Math.random().toString().slice(2, 9)

  $: classes = classnames(className, 'form-check');
</script>

<div class={classes}>
  <input type="checkbox" class="form-check-input" id={name} bind:checked={value} on:change on:blur />
  <label class="form-check-label" for={name}><slot /></label>
</div>
