<script lang="ts">
import { classnames } from "@/utils";


  export let value: boolean;

  let className = '';
  export { className as class };

  const name = "check-" + Math.random().toString().slice(2, 9)

  $: classes = classnames(className, 'form-check');
</script>

<div class={classes}>
  <input type="checkbox" class="form-check-input" id={name} on:change on:blur bind:checked={value} />
  <label class="form-check-label" for={name}><slot /></label>
</div>
