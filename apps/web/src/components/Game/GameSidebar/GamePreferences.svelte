<script lang="ts">
  import PreferencesChooser from "@/components/User/PreferencesChooser.svelte";
  import IconInfoCircleFill from "@/components/icons/IconInfoCircleFill.svelte";
  import type { GameContext } from "@/routes/game/[gameId]/game-context";
  import { getContext } from "svelte";

  const { gameInfo } = getContext("game") as GameContext;

  let showPreferences = $derived(
    !!gameInfo?.viewer?.alternate?.url || (gameInfo?.preferences?.some((item) => item.type !== "hidden") ?? false)
  );
</script>

{#if showPreferences && gameInfo}
  <div class="mt-3">
    <h3 class="flex items-center gap-1">
      Preferences
      <a href={`/page/${gameInfo._id.game}/preferences`}>
        <IconInfoCircleFill class="text-xs" />
      </a>
    </h3>
    <PreferencesChooser {gameInfo} />
  </div>
{/if}
