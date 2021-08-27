<script lang="ts">
import { latestBoardgames, loadBoardgames } from "@/api";
import { loadAllGameSettings } from "@/api/gamesettings";
import { CardDeck, Card, CardText } from "@/modules/cdk";
import Loading from "@/modules/cdk/Loading.svelte";
import { navigate } from "@/modules/router";
import { gameSettings, user } from "@/store";
import { handleError, confirm, createWatcher } from "@/utils";
import type { GameInfo } from "@lib/gameinfo";
import type { SetOptional } from "type-fest";

import marked from "marked";

export let newGame = false;
export let title = "Game selection"

let info = latestBoardgames();
let loading = info.length === 0;

loadBoardgames().then(() => {
  loading = false;
  info = latestBoardgames()
}).catch(handleError)

loadAllGameSettings().catch(handleError)

const watcher = createWatcher(() => Promise.all([loadBoardgames(), loadAllGameSettings()]))

$: watcher($user) 

const onGameClick  = async (gameInfo: SetOptional<GameInfo, 'viewer'>) => {
  if (newGame) {
    if (gameInfo.meta.needOwnership && !$gameSettings[gameInfo._id.game]?.access?.ownership) {
      await confirm("You need to have game ownership to host a new game. You can set game ownership in your account settings.");
    } else {
      navigate(`/new-game/${gameInfo._id.game}`)
    }
    return;
  }

  navigate(`/boardgame/${gameInfo._id.game}`);
}
</script>

<div class="container">
  <h1 class="mb-4">{title}</h1>
  <Loading {loading}>
    <CardDeck class="game-choice">
      {#each info as game}
        <Card header={game.label} class="border-secondary text-center" on:click={() => onGameClick(game)}>
          <CardText class="text-left">
            {@html marked(game.description)}
          </CardText>
          <span
            slot="footer"
            class:text-info={$gameSettings[game._id.game]?.access?.ownership}
            class:text-secondary={!$gameSettings[game._id.game]?.access?.ownership}
          >
            {#if $gameSettings[game._id.game]?.access?.ownership}
              You own this game
            {:else}
              You do not own this game
            {/if}
          </span>
        </Card>
      {/each}
    </CardDeck>
  </Loading>
</div>

<style lang="postcss" global>
  .game-choice {
    .card {
      transition: border-color;
      transition-duration: 0.3s;
      transition-timing-function: ease;
    }

    .card:hover {
      border-color: var(--info) !important;

      cursor: pointer;
    }

    .card-header {
      transition: color;
      transition-duration: 0.3s;
      transition-timing-function: ease;
    }
    .card:hover .card-header {
      color: var(--info);
    }
  }
</style>
