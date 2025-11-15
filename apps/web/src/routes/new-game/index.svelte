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
  import { confirm, createWatcher } from "@/utils";
  import marked from "marked";
  import type { IterableElement } from "type-fest";

  const { latestGameInfos } = useGameInfo();
  const { gamePreferences, loadAllGamePreferences } = useGamePreferences();
  const { accountId } = useAccount();

  let info = latestGameInfos();

  const watcher = createWatcher(loadAllGamePreferences);
  $: (watcher(), [$accountId]);

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
        <Card header={game.label} class="border-secondary h-100" onclick={() => onClick(game)}>
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
