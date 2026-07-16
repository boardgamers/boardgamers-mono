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
          ...(gameInfo.preferences ?? []),
        ]
      : (gameInfo?.preferences ?? []),
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
  <div class="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
    <button
      type="button"
      class="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
      aria-expanded={shownCategories[category.name] ?? false}
      onclick={() => {
        shownCategories[category.name] = !shownCategories[category.name];
      }}
    >
      {category.label}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        width="1em"
        height="1em"
        fill="currentColor"
        class="transition-transform duration-150 {shownCategories[category.name] ? 'rotate-180' : ''}"
      >
        <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z" />
      </svg>
    </button>
    {#if shownCategories[category.name]}
      <div class="space-y-2 border-t border-gray-200 px-3 py-2 dark:border-gray-700">
        {#each preferenceItems.filter((item) => item.category === category.name) as item}
          <PreferenceInput
            {item}
            value={preferences[item.name]}
            onchange={(val) => handleChange(item.name, val)}
          />
        {/each}
      </div>
    {/if}
  </div>
{/each}
