<script lang="ts">
  import { Card, CardText } from "@/modules/cdk";
  import { goto } from "$app/navigation";
  import { createWatcher } from "@/utils";
  import marked from "marked";
  import { latestGameInfos } from "@/lib/game-info.svelte";
  import { gamePreferences, loadAllGamePreferences } from "@/lib/game-preferences.svelte";
  import { account } from "@/lib/account.svelte";
  import { SEO } from "@/components";

  let info = latestGameInfos();

  const watcher = createWatcher(loadAllGamePreferences);
  $effect(() => {
    $account?._id;
    watcher();
  });
</script>

<SEO title="Game selection" />

<div class="container mx-auto px-4">
  <h1 class="mb-4">Game selection</h1>
  <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
    {#each info as game}
      <div>
        <Card
          header={game.label}
          class="border-gray-300 h-full dark:border-gray-600"
          onclick={() => goto(`/boardgame/${game._id.game}`)}
          role="button"
        >
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
