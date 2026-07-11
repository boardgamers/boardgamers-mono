<script lang="ts">
  import { gameInfo, loadGameInfo } from "@/lib/game-info.svelte";
  import { get } from "@/lib/api";
  import { handleError, pluralize } from "@/utils";
  import type { GamePreferencesFront } from "@bgs/models";
  import infoCircleFill from "@iconify/icons-bi/info-circle-fill.js";
  import { Icon } from "@/modules/cdk";

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
    <h3 class="card-title">
      Elo <a href="/page/elo"><Icon icon={infoCircleFill} class="text-secondary small" inline={true} /></a>
    </h3>
    <ul class="list-group text-start">
      {#each gamePreferences.filter((pref) => !!pref.elo) as gamePref}
        <div class="list-group-item list-group-item-action py-2">
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
