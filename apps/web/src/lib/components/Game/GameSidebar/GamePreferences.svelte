<script lang="ts">
  import PreferencesChooser from "$lib/components/User/PreferencesChooser.svelte";
  import type { GameContext } from "$lib/types/GameContext";
  import IconInfoCircleFill from "@iconify-svelte/bi/info-circle-fill";
  import { getContext } from "svelte";

  const { gameInfo } = getContext("game") as GameContext;

  $: showPreferences =
    !!$gameInfo?.viewer?.alternate?.url || $gameInfo?.preferences?.some((item) => item.type !== "hidden") > 0;
</script>

{#if showPreferences}
  <div class="mt-75">
    <h3>
      Preferences
      <a href={`/page/${$gameInfo._id.game}/preferences`}>
        <IconInfoCircleFill class="small" />
      </a>
    </h3>
    <PreferencesChooser game={$gameInfo} />
  </div>
{/if}
