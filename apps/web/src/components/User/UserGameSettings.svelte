<script lang="ts">
  import { set } from "lodash";
  import type { GameInfoFront } from "@bgs/models";
  import { handleError, confirm, classnames } from "@/utils";
  import Card from "@/modules/cdk/Card.svelte";
  import { CardText, FormGroup, Input } from "@/modules/cdk";
  import Checkbox from "@/modules/cdk/Checkbox.svelte";
  import Loading from "@/modules/cdk/Loading.svelte";
  import PreferencesChooser from "./PreferencesChooser.svelte";
  import { post } from "@/lib/api";
  import { gameInfoKey } from "@/lib/game-info.svelte";
  import { developerSettings, devGameSettings } from "@/lib/stores.svelte";
  import { gamePreferences, loadGamePreferences } from "@/lib/game-preferences.svelte";

  let {
    title = "",
    game,
    class: className = "",
  }: {
    title?: string;
    game: GameInfoFront;
    class?: string;
  } = $props();

  $effect(() => {
    loadGamePreferences(game._id.game);
  });

  let prefs = $derived($gamePreferences[game._id.game]);

  let ownership = $state(false);

  $effect(() => {
    ownership = prefs?.access?.ownership ?? false;
  });

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

  let classes = $derived(classnames(className, "border-secondary"));
  let key = $derived(gameInfoKey(game._id.game, game._id.version));

  let customViewerUrl = $state("");

  function updateDevSettings() {
    set($devGameSettings, `${key}.viewerUrl`, customViewerUrl);
    $devGameSettings = { ...$devGameSettings };
  }

  $effect(() => {
    customViewerUrl = $devGameSettings[key]?.viewerUrl ?? "";
  });

  $effect(() => {
    customViewerUrl;
    updateDevSettings();
  });
  $effect(() => {
    key;
    updateViewerUrl();
  });
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
