<script lang="ts">
  import { addDefaults, updatePreference } from "@/api";
  import { gameSettings } from "@/store";
  import { handleError } from "@/utils";
  import PreferenceInput from "./PreferenceInput.svelte";
  import type { GameInfo } from "@bgs/types";
  import type { Primitive } from "type-fest";

  let gameInfo: GameInfo;
  export { gameInfo as game };

  $: boardgameId = gameInfo._id.game;
  $: boardgameVersion = gameInfo._id.version;

  $: preferences = addDefaults($gameSettings[boardgameId], gameInfo)?.preferences || {};

  let shownCategories: Record<string, boolean> = {};

  const preferenceItems = gameInfo?.viewer?.alternate?.url
    ? [
        { name: "alternateUI", label: "Use alternate UI", type: "checkbox", items: null, category: null },
        ...gameInfo.preferences,
      ]
    : gameInfo.preferences;

  const handleChange = (key: string, val: Primitive) => {
    updatePreference(boardgameId, boardgameVersion, key, val).catch(handleError);
  };
</script>

{#each preferenceItems.filter((item) => item.type === "checkbox" && item.category == null) as item}
  <PreferenceInput {item} value={preferences[item.name]} on:change={(event) => handleChange(item.name, event.detail)} />
{/each}
{#each preferenceItems.filter((item) => item.type === "select" && item.category == null) as item}
  <PreferenceInput {item} value={preferences[item.name]} on:change={(event) => handleChange(item.name, event.detail)} />
{/each}
{#each preferenceItems.filter((item) => item.type === "category") as category}
  <a
    href={`#${category.name}`}
    on:click|preventDefault={() => (shownCategories[category.name] = !shownCategories[category.name])}
    >{category.label}</a
  >
  {#if shownCategories[category.name]}
    <div class="ms-2 mt-2">
      {#each preferenceItems.filter((item) => item.category === category.name) as item}
        <PreferenceInput
          {item}
          value={preferences[item.name]}
          on:change={(event) => handleChange(item.name, event.detail)}
        />
      {/each}
    </div>
  {/if}
{/each}
