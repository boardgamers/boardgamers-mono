<script context="module" lang="ts">
  import { useGameInfo } from "$lib/composition/useGameInfo";

  import { useLoad } from "$lib/composition/useLoad";
  import type { LoadInput } from "@sveltejs/kit";

  export async function load(input: LoadInput) {
    const { loadGameInfos, loadAllGamePreferences } = useLoad(input, useGameInfo, useGamePreferences);

    await Promise.all([loadGameInfos(), loadAllGamePreferences()]);

    return {};
  }
</script>

<script lang="ts">
  import { goto } from "$app/navigation";
  import { Card, CardText, Col } from "$cdk";
  import { useAccount } from "$lib/composition/useAccount";
  import { useGamePreferences } from "$lib/composition/useGamePreferences";
  import { SEO } from "@/components";
  import { createWatcher } from "@/utils";
  import marked from "marked";

  const { latestGameInfos } = useGameInfo();
  const { gamePreferences, loadAllGamePreferences } = useGamePreferences();
  const { accountId } = useAccount();

  let info = latestGameInfos();

  const watcher = createWatcher(loadAllGamePreferences);
  $: (watcher(), [$accountId]);
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
