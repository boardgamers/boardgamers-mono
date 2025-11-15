<script lang="ts">
  import { useAccount } from "$lib/composition/useAccount";
  import { useGamePreferences } from "$lib/composition/useGamePreferences";
  import { createWatcher, handleError } from "@/utils";
  import type { GameInfo } from "@bgs/types";
  import type { Primitive } from "type-fest";
  import PreferenceInput from "./PreferenceInput.svelte";

  const { gamePreferences, addDefaults, updatePreference, loadGamePreferences } = useGamePreferences();
  const { accountId } = useAccount();

  let gameInfo: GameInfo;
  export { gameInfo as game };

  $: boardgameId = gameInfo._id.game;
  $: boardgameVersion = gameInfo._id.version;

  $: preferences = addDefaults($gamePreferences[boardgameId], gameInfo)?.preferences || {};

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

  const loadPrefs = createWatcher(() => loadGamePreferences(boardgameId));

  $: (loadPrefs(), [$accountId]);
</script>

{#each preferenceItems.filter((item) => item.type === "checkbox" && item.category == null) as item}
  <PreferenceInput {item} value={preferences[item.name]} onchange={(event) => handleChange(item.name, event.detail)} />
{/each}
{#each preferenceItems.filter((item) => item.type === "select" && item.category == null) as item}
  <PreferenceInput {item} value={preferences[item.name]} onchange={(event) => handleChange(item.name, event.detail)} />
{/each}
{#each preferenceItems.filter((item) => item.type === "category") as category}
  <a
    href={`#${category.name}`}
    onclick|preventDefault={() => (shownCategories[category.name] = !shownCategories[category.name])}
    >{category.label}</a
  >
  {#if shownCategories[category.name]}
    <div class="ms-2 mt-2">
      {#each preferenceItems.filter((item) => item.category === category.name) as item}
        <PreferenceInput
          {item}
          value={preferences[item.name]}
          onchange={(event) => handleChange(item.name, event.detail)}
        />
      {/each}
    </div>
  {/if}
{/each}
