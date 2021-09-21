<script lang="ts">
  import { boardgameInfo, get, loadBoardgame } from "@/api";
  import { handleError, pluralize } from "@/utils";

  import type { GamePreferences } from "@bgs/types/gamepreferences";
  import { Icon } from "@cdk";

  export let userId: string;

  let gamePreferences: GamePreferences[] = [];

  const onUserIdChanged = () =>
    get<GamePreferences[]>(`/user/${userId}/games/elo`)
      .then((prefs) => (gamePreferences = prefs))
      .catch(handleError);

  $: onUserIdChanged(), [userId];

  async function gameName(game: string): Promise<string> {
    const info = boardgameInfo(game, "latest");

    if (!info) {
      return loadBoardgame(game, "latest").then(
        () => gameName(game),
        (err) => {
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
      Elo <a href="/page/elo"><Icon name="info-circle-fill" class="text-secondary small" /></a>
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
