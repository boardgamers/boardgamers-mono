<script lang="ts">
  import PreferencesChooser from "@/components/User/PreferencesChooser.svelte";
  import { Icon } from "@/modules/cdk";
  import type { GameContext } from "@/routes/game/[gameId]/game-context";
  import { getContext } from "svelte";
  import infoCircleFill from "@iconify/icons-bi/info-circle-fill.js";

  const { gameInfo } = getContext("game") as GameContext;

  let showPreferences = $derived(
    !!gameInfo?.viewer?.alternate?.url || (gameInfo?.preferences?.some((item) => item.type !== "hidden") ?? false)
  );
</script>

{#if showPreferences && gameInfo}
  <div class="mt-75">
    <h3>
      Preferences
      <a href={`/page/${gameInfo._id.game}/preferences`}>
        <Icon icon={infoCircleFill} class="small" />
      </a>
    </h3>
    <PreferencesChooser {gameInfo} />
  </div>
{/if}
