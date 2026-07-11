<script lang="ts">
  import { confirm, handleError } from "@/utils";
  import marked from "marked";
  import type { GameInfoFront } from "@bgs/models";
  import { Card, Row, Col } from "@/modules/cdk";
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

<div class="home container">
  <h1>{boardgame.label}</h1>

  <div class="row row-cols-1 row-cols-md-2 g-4">
    <Col>
      <Card class="border-secondary h-100" header={rules ? "Rules" : "Description"}>
        {@html marked(rules ? boardgame.rules : boardgame.description)}
        {#snippet footer()}
          <a href={rules ? "#description" : "#rules"} onclick={(e) => { e.preventDefault(); rules = !rules; }}>
            {rules ? "See description" : "See rules"}
          </a>
        {/snippet}
      </Card>
    </Col>
    <Col>
      <UserGameSettings title="Settings" game={boardgame} class="h-100" />
    </Col>
  </div>

  <Row>
    <Col lg={6} class="mt-3">
      <GameList
        {boardgameId}
        gameStatus="active"
        userId={$account?._id}
        perPage={5}
        topRecords
        title={$account?._id ? "My games" : "Featured games"}
      />
    </Col>
    <Col lg={6} class="mt-3">
      <GameList sample perPage={5} {boardgameId} gameStatus="open" title="Lobby" />
    </Col>
  </Row>

  <div class="text-center mt-3">
    <a class="btn btn-accent" href={`/boardgame/${boardgameId}/games`} role="button">All games</a>
    <button class="btn btn-primary mx-3" href="/new-game" onclick={newGame}>New Game</button>
    <a class="btn btn-accent" href={`/boardgame/${boardgameId}/rankings`} role="button">Rankings</a>
  </div>

  <Row>
    <Col lg={6} class="mt-3">
      <GameList gameStatus="active" {boardgameId} topRecords perPage={5} title="Featured games" />
      <!-- <h3>Tournaments</h3>
      <p> No Tournament info available </p> -->
    </Col>
    <Col lg={6} class="mt-3">
      <!-- Todo: show rank of current player if possible with mongodb in an optimized way in the list -->
      <BoardgameElo initial={data.rankings} {boardgameId} top perPage={6} />
    </Col>
  </Row>
</div>
