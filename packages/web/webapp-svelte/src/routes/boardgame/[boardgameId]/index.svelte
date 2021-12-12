<script lang="ts">
  import { confirm, handleError } from "@/utils";
  import marked from "marked";
  import type { GameInfo } from "@bgs/types";
  import { Card, Row, Col, Loading } from "@/modules/cdk";
  import { UserGameSettings, GameList, BoardgameElo } from "@/components";
  import { useAccount } from "@/composition/useAccount";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { useGamePreferences } from "@/composition/useGamePreferences";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";

  const { accountId } = useAccount();
  const { gameInfos, gameInfo, loadGameInfo } = useGameInfo();
  const { gamePreferences, loadGamePreferences } = useGamePreferences();

  $: boardgameId = $page.params.boardgameId;

  let boardgame: GameInfo;

  const onUserChanged = () => {
    loadGameInfo(boardgameId, "latest").catch(handleError);
    loadGamePreferences(boardgameId).catch(handleError);
  };

  $: onUserChanged(), [accountId, boardgameId];
  $: (boardgame = gameInfo(boardgameId, "latest") as GameInfo), [gameInfos];
  $: loading = !boardgame;
  $: hasOwnership = $gamePreferences[boardgameId]?.access?.ownership;
  $: needOwnership = boardgame?.meta?.needOwnership;

  async function newGame() {
    if (needOwnership && !hasOwnership) {
      await confirm(
        "You need to have game ownership to host a new game. You can set game ownership in your account settings."
      );
    } else {
      goto(`/new-game/${boardgameId}`);
    }
  }

  $: rules = $page.query.get("infobox") === "rules";
</script>

<svelte:head>
  <title>{boardgame?.label} - Boardgamers 🌌</title>
</svelte:head>

<div class="home container">
  <Loading {loading}>
    <h1>{boardgame.label}</h1>

    <div class="row row-cols-1 row-cols-md-2 g-4">
      <Col>
        <Card class="border-secondary h-100" header={rules ? "Rules" : "Description"}>
          {@html marked(rules ? boardgame.rules : boardgame.description)}
          <a slot="footer" href={`?infobox=${rules ? "description" : "rules"}`}
            >{rules ? "See description" : "See rules"}</a
          >
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
          userId={$accountId}
          sample
          perPage={5}
          title={$accountId ? "My games" : "Featured games"}
        />
      </Col>
      <Col lg={6} class="mt-3">
        <GameList sample perPage={5} {boardgameId} gameStatus="open" title="Lobby" />
      </Col>
    </Row>

    <div class="text-center mt-3">
      <a class="btn btn-secondary" href={`/boardgame/${boardgameId}/games`} role="button">All games</a>
      <button class="btn btn-primary mx-3" href="/new-game" on:click={newGame}>New Game</button>
      <a class="btn btn-secondary" href={`/boardgame/${boardgameId}/rankings`} role="button">Rankings</a>
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
