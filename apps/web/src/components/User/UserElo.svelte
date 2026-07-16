<script lang="ts">
  import { gameInfo, loadGameInfo } from "@/lib/game-info.svelte";
  import { get } from "@/lib/api";
  import { handleError, pluralize } from "@/utils";
  import type { GamePreferencesFront } from "@bgs/models";
  import IconInfoCircleFill from "@/components/icons/IconInfoCircleFill.svelte";

  let { userId }: { userId: string } = $props();

  let gamePreferences: GamePreferencesFront[] = $state([]);

  const onUserIdChanged = () =>
    get<GamePreferencesFront[]>(`/user/${userId}/games/elo`)
      .then((prefs) => (gamePreferences = prefs))
      .catch(handleError);

  $effect(() => {
    userId;
    onUserIdChanged();
  });

  async function gameName(game: string): Promise<string> {
    const info = gameInfo(game, "latest");

    if (!info) {
      return loadGameInfo(game, "latest").then(
        () => gameName(game),
        (err: Error) => {
          handleError(err);
          return "error";
        }
      );
    }

    return info.label;
  }
</script>

{#if gamePreferences.some((pref) => pref.elo)}
  <div>
    <h3 class="font-semibold">
      Elo <a href="/page/elo"
        ><IconInfoCircleFill class="text-gray-500 text-xs dark:text-gray-400" /></a
      >
    </h3>
    <ul class="divide-y divide-gray-200 text-start dark:divide-gray-700">
      {#each gamePreferences.filter((pref) => !!pref.elo) as gamePref}
        <div class="cursor-pointer px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
          <span>
            {#await gameName(gamePref.game) then name}
              {name} - <b>{gamePref.elo.value}</b> in
              {pluralize(gamePref.elo.games, "game")}
            {/await}
          </span>
        </div>
      {/each}
    </ul>
  </div>
{/if}
