<script lang="ts">
  import { confirm, handleError } from "@/utils";
  import marked from "marked";
  import type { GameInfoFront } from "@bgs/models";
  import { Button, Card } from "@/modules/cdk";
  import { UserGameSettings, GameList, BoardgameElo, SEO } from "@/components";
  import { account } from "@/lib/account.svelte";
  import { gameInfo, loadGameInfo, gameInfos } from "@/lib/game-info.svelte";
  import { gamePreferences, loadGamePreferences } from "@/lib/game-preferences.svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import type { LoadEloRankingsResult } from "@/lib/elo-rankings.svelte";
  import { gameLabel } from "@/utils/game-label";

  let { data }: { data: { rankings: LoadEloRankingsResult } } = $props();

  let boardgameId = $derived($page.params.boardgameId);
  let boardgame = $derived.by(() => {
    // track the gameInfos store so this re-evaluates after loadGameInfo resolves
    $gameInfos;
    return gameInfo(boardgameId, "latest") as GameInfoFront;
  });
  let hasOwnership = $derived($gamePreferences[boardgameId]?.access?.ownership);
  let needOwnership = $derived(boardgame?.meta?.needOwnership);

  let rules = $state(false);

  const onUserChanged = () => {
    loadGameInfo(boardgameId, "latest").catch(handleError);
    loadGamePreferences(boardgameId).catch(handleError);
  };

  // re-run whenever the logged-in account or boardgame changes
  $effect(() => {
    $account?._id;
    boardgameId;
    onUserChanged();
  });

  async function newGame() {
    if (needOwnership && !hasOwnership) {
      await confirm(
        "You need to have game ownership to host a new game. You can set game ownership in your account settings."
      );
    } else {
      goto(`/new-game/${boardgameId}`);
    }
  }
</script>

<SEO
  title={`${gameLabel(boardgame.label)} - Boardgames`}
  description={`Play ${gameLabel(boardgame.label)} online with other people!`}
/>

<div class="container mx-auto px-4">
  <h1>{boardgame.label}</h1>

  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <div>
      <Card class="border-gray-300 h-full dark:border-gray-600" header={rules ? "Rules" : "Description"}>
        {@html marked(rules ? boardgame.rules : boardgame.description)}
        {#snippet footer()}
          <a href={rules ? "#description" : "#rules"} onclick={(e) => { e.preventDefault(); rules = !rules; }}>
            {rules ? "See description" : "See rules"}
          </a>
        {/snippet}
      </Card>
    </div>
    <div>
      <UserGameSettings title="Settings" game={boardgame} class="h-full" />
    </div>
  </div>

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <div class="mt-3">
      <GameList
        {boardgameId}
        gameStatus="active"
        userId={$account?._id}
        perPage={5}
        topRecords
        title={$account?._id ? "My games" : "Featured games"}
      />
    </div>
    <div class="mt-3">
      <GameList sample perPage={5} {boardgameId} gameStatus="open" title="Lobby" />
    </div>
  </div>

  <div class="mt-3 text-center">
    <Button color="accent" href={`/boardgame/${boardgameId}/games`}>All games</Button>
    <Button color="primary" class="mx-3" onclick={newGame}>New Game</Button>
    <Button color="accent" href={`/boardgame/${boardgameId}/rankings`}>Rankings</Button>
  </div>

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <div class="mt-3">
      <GameList gameStatus="active" {boardgameId} topRecords perPage={5} title="Featured games" />
      <!-- <h3>Tournaments</h3>
      <p> No Tournament info available </p> -->
    </div>
    <div class="mt-3">
      <!-- Todo: show rank of current player if possible with mongodb in an optimized way in the list -->
      <BoardgameElo initial={data.rankings} {boardgameId} top perPage={6} />
    </div>
  </div>
</div>
