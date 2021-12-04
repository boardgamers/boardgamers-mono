<script lang="ts">
  import { addDefaults, updatePreference } from "@/api";
  import { FormGroup, Input, Label } from "@/modules/cdk";
  import Checkbox from "@/modules/cdk/Checkbox.svelte";
  import { gameSettings } from "@/store";
  import { handleError, oneLineMarked } from "@/utils";
  import type { GameInfo } from "@bgs/types";
  import type { Primitive } from "type-fest";

  let gameInfo: GameInfo;
  export { gameInfo as game };

  $: boardgameId = gameInfo._id.game;
  $: boardgameVersion = gameInfo._id.version;

  $: preferences = addDefaults($gameSettings[boardgameId], gameInfo)?.preferences || {};

  const preferenceItems = gameInfo?.viewer?.alternate?.url
    ? [{ name: "alternateUI", label: "Use alternate UI", type: "checkbox", items: null }, ...gameInfo.preferences]
    : gameInfo.preferences;

  const handleChange = (key: string, val: Primitive) => {
    updatePreference(boardgameId, boardgameVersion, key, val).catch(handleError);
  };
</script>

{#each preferenceItems.filter((item) => item.type === "checkbox") as item}
  <Checkbox checked={preferences[item.name]} on:change={(event) => handleChange(item.name, event.target.checked)}>
    {item.label}
  </Checkbox>
{/each}
{#each preferenceItems.filter((item) => item.type === "select") as item}
  <FormGroup class="d-flex align-items-center mt-2">
    <Label class="nowrap me-2 mb-0">{@html oneLineMarked(item.label)}</Label>
    <Input
      type="select"
      value={preferences[item.name]}
      on:change={(event) => handleChange(item.name, event.target.value)}
      size="sm"
    >
      {#each item.items as option}
        <option value={option.name}>{option.label}</option>
      {/each}
    </Input>
  </FormGroup>
{/each}
