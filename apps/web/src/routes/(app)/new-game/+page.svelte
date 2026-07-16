<script lang="ts">
  import { Card, CardText } from "@/modules/cdk";
  import { confirm, createWatcher } from "@/utils";
  import marked from "marked";
  import { goto } from "$app/navigation";
  import { latestGameInfos } from "@/lib/game-info.svelte";
  import { gamePreferences, loadAllGamePreferences } from "@/lib/game-preferences.svelte";
  import { account } from "@/lib/account.svelte";
  import type { IterableElement } from "type-fest";
  import { SEO } from "@/components";

  let info = latestGameInfos();

  const watcher = createWatcher(loadAllGamePreferences);
  $effect(() => {
    $account?._id;
    watcher();
  });

  const onClick = async (gameInfo: IterableElement<typeof info>) => {
    if (gameInfo.meta.needOwnership && !$gamePreferences[gameInfo._id.game]?.access?.ownership) {
      await confirm(
        "You need to have game ownership to host a new game. You can set game ownership in your account settings."
      );
    } else {
      goto(`/new-game/${gameInfo._id.game}`);
    }
    return;
  };
</script>

<SEO title="Choose which game to play" description="Play a boardgame of your choice online with other people!" />

<div class="container mx-auto px-4">
  <h1 class="mb-4">Choose which game to play</h1>
  <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
    {#each info as game}
      <div role="button">
        <Card header={game.label} class="border-gray-300 h-full dark:border-gray-600" onclick={() => onClick(game)}>
          <CardText>
            {@html marked(game.description)}
          </CardText>
          {#snippet footer()}
            <span
              class:text-accent={$gamePreferences[game._id.game]?.access?.ownership}
              class:text-gray-500={!$gamePreferences[game._id.game]?.access?.ownership}
              class:dark:text-gray-400={!$gamePreferences[game._id.game]?.access?.ownership}
            >
              {#if $gamePreferences[game._id.game]?.access?.ownership}
                You own this game
              {:else}
                You do not own this game
              {/if}
            </span>
          {/snippet}
        </Card>
      </div>
    {/each}
  </div>
</div>
