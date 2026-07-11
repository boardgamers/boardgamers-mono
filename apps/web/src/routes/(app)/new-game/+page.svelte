<script lang="ts">
  import { Card, CardText, Col } from "@/modules/cdk";
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
  $: (watcher(), [$account?._id]);

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

<div class="container">
  <h1 class="mb-4">Choose which game to play</h1>
  <div class="row row-cols-1 row-cols-md-3 g-4 game-choice">
    {#each info as game}
      <Col role="button">
        <Card header={game.label} class="border-secondary h-100" on:click={() => onClick(game)}>
          <CardText>
            {@html marked(game.description)}
          </CardText>
          <span
            slot="footer"
            class:text-accent={$gamePreferences[game._id.game]?.access?.ownership}
            class:text-secondary={!$gamePreferences[game._id.game]?.access?.ownership}
          >
            {#if $gamePreferences[game._id.game]?.access?.ownership}
              You own this game
            {:else}
              You do not own this game
            {/if}
          </span>
        </Card>
      </Col>
    {/each}
  </div>
</div>
