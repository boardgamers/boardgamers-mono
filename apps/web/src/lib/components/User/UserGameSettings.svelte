<script lang="ts">
  import { CardText, FormGroup, Input } from "$cdk";
  import Card from "$cdk/Card.svelte";
  import Checkbox from "$cdk/Checkbox.svelte";
  import Loading from "$cdk/Loading.svelte";
  import { useDeveloperSettings } from "$lib/composition/useDeveloperSettings";
  import { useGameInfo } from "$lib/composition/useGameInfo";
  import { useGamePreferences } from "$lib/composition/useGamePreferences";
  import { useRest } from "$lib/composition/useRest";
  import { classnames, confirm, handleError } from "@/utils";
  import type { GameInfo } from "@bgs/types";
  import { set } from "lodash";
  import PreferencesChooser from "./PreferencesChooser.svelte";

  const { post } = useRest();
  const { gameInfoKey } = useGameInfo();
  const { developerSettings, devGameSettings } = useDeveloperSettings();
  const { gamePreferences, loadGamePreferences } = useGamePreferences();

  export let title = "";
  export let game: GameInfo;
  let className = "";
  export { className as class };

  $: loadGamePreferences(game._id.game);

  $: prefs = $gamePreferences[game._id.game];

  $: ownership = prefs?.access?.ownership ?? false;

  async function postOwnership(event: Event) {
    const newVal = (event.target! as HTMLInputElement).checked;

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
      prefs.access = { ...prefs.access, ownership: newVal };
    } catch (err) {
      handleError(err);
    }
  }

  $: classes = classnames(className, "border-secondary");
  $: key = gameInfoKey(game._id.game, game._id.version);

  let customViewerUrl = $devGameSettings[gameInfoKey(game._id.game, game._id.version)]?.viewerUrl;

  function updateDevSettings() {
    set($devGameSettings, `${key}.viewerUrl`, customViewerUrl);
    $devGameSettings = { ...$devGameSettings };
  }

  function updateViewerUrl() {
    $devGameSettings[key]?.viewerUrl;
  }

  $: (updateDevSettings(), [customViewerUrl]);
  $: (updateViewerUrl(), [key]);
</script>

<Card class={classes} header={title || game.label}>
  <CardText class="h-100 d-flex" style="flex-direction: column">
    <Loading loading={!prefs}>
      <div style="flex-grow: 1">
        <Checkbox checked={ownership} onchange={postOwnership}>I own this game</Checkbox>
        {#if game.preferences?.length > 0}
          <hr />
          <PreferencesChooser {game} />
        {/if}
      </div>
      {#if $developerSettings}
        <hr />
        <FormGroup>
          <label for="viewerUrl">Custom Viewer URL ({key})</label>
          <Input type="text" placeholder="Viewer URL" bind:value={customViewerUrl} />
        </FormGroup>
      {/if}
    </Loading>
  </CardText>
</Card>
