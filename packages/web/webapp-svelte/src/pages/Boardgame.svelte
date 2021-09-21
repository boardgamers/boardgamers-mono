<script lang="ts">
  import { confirm, handleError } from "@/utils";
  import marked from "marked";
  import type { GameInfo } from "@bgs/types/gameinfo";
  import { boardgameInfo, loadBoardgame, loadGameSettings } from "@/api";
  import { boardgames, gameSettings, user } from "@/store";
  import { navigate, routePath } from "@/modules/router";
  import { Card, Row, Col, Loading } from "@/modules/cdk";
  import { UserGameSettings, GameList, BoardgameElo } from "@/components";

  export let boardgameId: string;

  let boardgame: GameInfo;

  const onUserChanged = () => {
    loadBoardgame(boardgameId, "latest").catch(handleError);
    loadGameSettings(boardgameId).catch(handleError);
  };

  $: onUserChanged(), [$user, boardgameId];
  $: (boardgame = boardgameInfo(boardgameId, "latest") as GameInfo), [$boardgames];
  $: loading = !boardgame;
  $: hasOwnership = $gameSettings[boardgameId]?.access?.ownership;
  $: needOwnership = boardgame?.meta?.needOwnership;

  async function newGame() {
    if (needOwnership && !hasOwnership) {
      await confirm(
        "You need to have game ownership to host a new game. You can set game ownership in your account settings."
      );
    } else {
      navigate(`/new-game/${boardgameId}`);
    }
  }
</script>

<svelte:head>
  <title>{boardgame?.label} - Boardgamers 🌌</title>
</svelte:head>

<div class="home container">
  <Loading {loading}>
    <h1>{boardgame.label}</h1>

    <div class="row row-cols-1 row-cols-md-2 g-4">
      <Col>
        <Card class="border-secondary h-100" header="Description">
          {@html marked(boardgame.description)}
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
          userId={$user?._id}
          sample
          perPage={5}
          title={$user ? "My games" : "Featured games"}
        />
      </Col>
      <Col lg={6} class="mt-3">
        <GameList sample perPage={5} {boardgameId} gameStatus="open" title="Lobby" />
      </Col>
    </Row>

    <div class="text-center mt-3">
      <a class="btn btn-secondary" href={routePath({ name: "bg-games", params: { boardgameId } })} role="button"
        >All games</a
      >
      <button class="btn btn-primary mx-3" href="/new-game" on:click={newGame}>New Game</button>
      <a class="btn btn-secondary" href={routePath({ name: "bg-rankings", params: { boardgameId } })} role="button"
        >Rankings</a
      >
    </div>

    <Row>
      <Col lg={6} class="mt-3">
        <GameList gameStatus="active" {boardgameId} topRecords perPage={5} title="Featured games" />
        <!-- <h3>Tournaments</h3>
        <p> No Tournament info available </p> -->
      </Col>
      <Col lg={6} class="mt-3">
        <!-- Todo: show rank of current player if possible with mongodb in an optimized way in the list -->
        <BoardgameElo {boardgameId} top perPage={7} />
      </Col>
    </Row>
  </Loading>
</div>
