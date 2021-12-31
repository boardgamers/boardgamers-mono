<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const boardgameId = input.params.boardgameId;
    const { account, loadGames, loadEloRankings } = useLoad(input, useGames, useAccount, useEloRankings);

    const featuredGames = loadGames({
      gameStatus: "active",
      count: 5,
      boardgameId,
      fetchCount: false,
      store: true,
    });

    const myGames = loadGames({
      gameStatus: "active",
      count: 5,
      boardgameId,
      userId: storeGet(account)?._id,
      store: true,
    });

    const lobbyGames = loadGames({ sample: true, gameStatus: "open", boardgameId, count: 5, store: true });

    const [_1, _2, _3, rankings] = await Promise.all([
      featuredGames,
      myGames,
      lobbyGames,
      loadEloRankings({ boardgameId, count: 6, fetchCount: false }),
    ]);

    return { props: { rankings } };
  }
</script>

<script lang="ts">
  import { confirm, handleError } from "@/utils";
  import marked from "marked";
  import type { GameInfo } from "@bgs/types";
  import { Card, Row, Col } from "@/modules/cdk";
  import { UserGameSettings, GameList, BoardgameElo, SEO } from "@/components";
  import { useAccount } from "@/composition/useAccount";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { useGamePreferences } from "@/composition/useGamePreferences";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import type { LoadInput } from "@sveltejs/kit";
  import { useLoad } from "@/composition/useLoad";
  import { useGames } from "@/composition/useGames";
  import { get as storeGet } from "svelte/store";
  import { LoadEloRankingsResult, useEloRankings } from "@/composition/useEloRankings";
  import { gameLabel } from "@/utils/game-label";

  const { accountId } = useAccount();
  const { gameInfos, gameInfo, loadGameInfo } = useGameInfo();
  const { gamePreferences, loadGamePreferences } = useGamePreferences();

  $: boardgameId = $page.params.boardgameId;

  let boardgame: GameInfo;

  export let rankings: LoadEloRankingsResult;
  let rules = false;

  const onUserChanged = () => {
    loadGameInfo(boardgameId, "latest").catch(handleError);
    loadGamePreferences(boardgameId).catch(handleError);
  };

  $: onUserChanged(), [accountId, boardgameId];
  $: (boardgame = gameInfo(boardgameId, "latest") as GameInfo), [gameInfos];
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
        <a slot="footer" href={rules ? "#description" : "#rules"} on:click|preventDefault={() => (rules = !rules)}>
          {rules ? "See description" : "See rules"}
        </a>
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
    <a class="btn btn-accent" href={`/boardgame/${boardgameId}/games`} role="button">All games</a>
    <button class="btn btn-primary mx-3" href="/new-game" on:click={newGame}>New Game</button>
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
      <BoardgameElo initial={rankings} {boardgameId} top perPage={6} />
    </Col>
  </Row>
</div>
