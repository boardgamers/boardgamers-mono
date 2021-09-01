<script lang="ts">
import type { GameInfo } from "@shared/types/gameinfo";
import { handleError, confirm, classnames } from "@/utils";
import Card from "@/modules/cdk/Card.svelte";
import { CardText } from "@/modules/cdk";
import Checkbox from "@/modules/cdk/Checkbox.svelte";
import Loading from "@/modules/cdk/Loading.svelte";
import { loadGameSettings } from "@/api/gamesettings";
import { gameSettings } from "@/store";
import { post } from "@/api";
import PreferencesChooser from "./PreferencesChooser.svelte";

export let title = "";
export let game: GameInfo;
let className = '';
export { className as class };

$: loadGameSettings(game._id.game);

$: prefs = $gameSettings[game._id.game]

$: ownership = prefs?.access?.ownership ?? false

async function postOwnership(event: Event) {
  const newVal = (event.target! as HTMLInputElement).checked

  if (newVal) {
    const res = await confirm("I certify on my honor that I own a copy of the game");

    if (!res) {
      ownership = false;
      (event.target! as HTMLInputElement).checked = false;
      return;
    }
  }

  try {
    await post(`/account/games/${game._id.game}/ownership`, {
      access: { ...prefs.access, ownership: newVal },
    });
    prefs.access = {...prefs.access, ownership: newVal}
  } catch (err) {
    handleError(err);
  }
}

$: classes = classnames(className, 'border-secondary text-center');

</script>

<Card class={classes} header={title || game.label}>
  <CardText class="text-start">
    <Loading loading={!prefs}>
      <Checkbox checked={ownership} on:change={postOwnership}>I own this game</Checkbox>
      {#if game.preferences?.length > 0}
        <hr />
        <PreferencesChooser {game} />
      {/if}
    </Loading>
  </CardText>
</Card>
