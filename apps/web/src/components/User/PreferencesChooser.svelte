<script lang="ts">
  import { createWatcher, handleError } from "@/utils";
  import PreferenceInput from "./PreferenceInput.svelte";
  import type { GameInfoFront } from "@bgs/models";
  import type { Primitive } from "type-fest";
  import { gamePreferences, addDefaults, updatePreference, loadGamePreferences } from "@/lib/game-preferences.svelte";
  import { account } from "@/lib/stores.svelte";

  let { game: gameInfo }: { game: GameInfoFront } = $props();

  let boardgameId = $derived(gameInfo._id.game);
  let boardgameVersion = $derived(gameInfo._id.version);

  let preferences = $derived(addDefaults($gamePreferences[boardgameId], gameInfo)?.preferences || {});

  let shownCategories: Record<string, boolean> = $state({});

  const preferenceItems = $derived(
    gameInfo?.viewer?.alternate?.url
      ? [
          { name: "alternateUI", label: "Use alternate UI", type: "checkbox", items: null, category: null },
          ...gameInfo.preferences,
        ]
      : gameInfo.preferences
  );

  const handleChange = (key: string, val: Primitive) => {
    updatePreference(boardgameId, boardgameVersion, key, val).catch(handleError);
  };

  const loadPrefs = createWatcher(() => loadGamePreferences(boardgameId));

  $effect(() => {
    $account?._id;
    loadPrefs();
  });
</script>

{#each preferenceItems.filter((item) => item.type === "checkbox" && item.category == null) as item}
  <PreferenceInput {item} value={preferences[item.name]} onchange={(val) => handleChange(item.name, val)} />
{/each}
{#each preferenceItems.filter((item) => item.type === "select" && item.category == null) as item}
  <PreferenceInput {item} value={preferences[item.name]} onchange={(val) => handleChange(item.name, val)} />
{/each}
{#each preferenceItems.filter((item) => item.type === "category") as category}
  <a
    href={`#${category.name}`}
    onclick={(e) => { e.preventDefault(); shownCategories[category.name] = !shownCategories[category.name]; }}
    >{category.label}</a
  >
  {#if shownCategories[category.name]}
    <div class="ms-2 mt-2">

      {#each preferenceItems.filter((item) => item.category === category.name) as item}
        <PreferenceInput
          {item}
          value={preferences[item.name]}
          onchange={(val) => handleChange(item.name, val)}
        />
      {/each}
    </div>
  {/if}
{/each}
