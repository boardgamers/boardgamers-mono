<script lang="ts">
  import { FormGroup, Input, Label } from "$cdk";
  import Checkbox from "$cdk/Checkbox.svelte";
  import { oneLineMarked } from "@/utils";
  import type { GameInfoOption } from "@bgs/types";
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{ change: string | boolean }>();

  export let item!: GameInfoOption;
  export let value!: any;

  function handleChange(val: string | boolean) {
    value = val;
    dispatch("change", val);
  }
</script>

{#if item.type === "checkbox"}
  <Checkbox checked={value} onchange={(event) => handleChange(event.target.checked)}>
    {item.label}
  </Checkbox>
{:else if item.type === "select"}
  <FormGroup class="d-flex align-items-center mt-2">
    <Label class="nowrap me-2 mb-0">{@html oneLineMarked(item.label)}</Label>
    <Input type="select" {value} onchange={(event) => handleChange(event.target.value)} bsSize="sm">
      {#each item.items as option}
        <option value={option.name}>{option.label}</option>
      {/each}
    </Input>
  </FormGroup>
{/if}
