<script lang="ts">
  import { Card, CardText, Col } from "@/modules/cdk";
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

<div class="container">
  <h1 class="mb-4">Game selection</h1>
  <div class="row row-cols-1 row-cols-md-3 g-4 game-choice">
    {#each info as game}
      <Col>
        <Card
          header={game.label}
          class="border-secondary h-100"
          onclick={() => goto(`/boardgame/${game._id.game}`)}
          role="button"
        >
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
