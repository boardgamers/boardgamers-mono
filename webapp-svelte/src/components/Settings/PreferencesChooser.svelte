<script lang="ts">
  import { post } from "@/api";
  import { FormGroup, Input, Label } from "@/modules/cdk";
  import Checkbox from "@/modules/cdk/Checkbox.svelte";
  import { gameSettings, user } from "@/store";
  import { oneLineMarked } from "@/utils";
  import type { GameInfo } from "@lib/gameinfo";

  let gameInfo: GameInfo
  export {gameInfo as game}

  $: boardgameId = gameInfo._id.game
  $: boardgameVersion = gameInfo._id.version

  $: preferences = $gameSettings[boardgameId]?.preferences || {}

  const preferenceItems = gameInfo?.viewer?.alternate?.url ? [
    { name: "alternateUI", label: "Use alternate UI", type: "checkbox", items: null },
    ...gameInfo.preferences
  ] : gameInfo.preferences

  async function postPreferences() {
    // Trigger update to subscribers
    $gameSettings = {...$gameSettings}

    if (!$user) {
      return;
    }
    await post(
      `/account/games/${boardgameId}/preferences/${boardgameVersion}`, 
      preferences
    );
  }
</script>

{#each preferenceItems.filter((item) => item.type === "checkbox") as item}
  <Checkbox bind:checked={preferences[item.name]} on:change={postPreferences}>
    {item.label}
  </Checkbox>
{/each}
{#each preferenceItems.filter((item) => item.type === "select") as item}
  <FormGroup class="d-flex align-items-center mt-2">
    <Label class="nowrap mr-2 mb-0">{@html oneLineMarked(item.label)}</Label>
    <Input type="select" bind:value={preferences[item.name]} on:change={postPreferences} size="sm">
      {#each item.items as option}
        <option value={option.name}>{option.label}</option>
      {/each}
    </Input>
  </FormGroup>
{/each}
