<script lang="ts">
import type { GameInfo } from "@lib/gameinfo";
import { handleError, confirm } from "../utils";
import Card from "@/modules/cdk/Card.svelte";
import { CardText } from "@/modules/cdk";
import Checkbox from "@/modules/cdk/Checkbox.svelte";
import Loading from "@/modules/cdk/Loading.svelte";
import { loadGameSettings } from "@/api/gamesettings";
import { gameSettings } from "@/store";
import { post } from "@/api";

export let title = "";
export let game: GameInfo;

$: loadGameSettings(game._id.game);

$: prefs = $gameSettings[game._id.game]

$: ownership = prefs?.access?.ownership ?? false

async function postOwnership() {
  if (ownership) {
    const res = await confirm("I certify on my honor that I own a copy of the game");

    if (!res) {
      ownership = false;
      return;
    }
  }

  try {
    await post(`/account/games/${game._id.game}/ownership`, {
      access: { ...prefs.access, ownership },
    });
    prefs.access = {...prefs.access, ownership}
  } catch (err) {
    handleError(err);
  }
}

async function postPreferences() {
  await post(`/account/games/${game._id.game}/preferences/${game._id.version}`, prefs.preferences)
    .catch(handleError);
}

</script>

<Card class="border-secondary text-center" header={title || game.label}>
  <CardText class="text-left">
    <Loading loading={!prefs}>
      <Checkbox bind:value={ownership} on:change={postOwnership}>I own this game</Checkbox>
      {#if game.preferences?.length > 0}
        <hr />
        {#each game.preferences as pref}
          <Checkbox bind:value={prefs.preferences[pref.name]} on:change={postPreferences}>
            {pref.label}
          </Checkbox>
        {/each}
      {/if}
    </Loading>
  </CardText>
</Card>
