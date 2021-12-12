<script lang="ts" context="module">
  import { get as storeGet } from "svelte/store";

  export async function load(input: LoadInput) {
    const { get, loadGameInfos, activeGames, loadGames, account } = useLoad(
      input,
      useRest,
      useGameInfo,
      useActiveGames,
      useGames,
      useAccount
    );

    const firstGames = loadGames({
      gameStatus: "active",
      count: 5,
      ...(storeGet(activeGames).length > 0 ? { userId: storeGet(account)?._id } : { fetchCount: false }),
    });
    const secondGames = loadGames({ sample: true, gameStatus: "open", count: 5 });

    const [firstGameInfo, secondGameInfo] = await Promise.all([firstGames, secondGames, loadGameInfos()]);

    return {
      props: {
        announcement: await get("/site/announcement"),
        firstGameInfo,
        secondGameInfo,
      },
    };
  }
</script>

<script lang="ts">
  import { Col, Row } from "sveltestrap";
  import { GameList } from "@/components";
  import marked from "marked";
  import { useRest } from "@/composition/useRest";
  import { useActiveGames } from "@/composition/useActiveGames";
  import { useAccount } from "@/composition/useAccount";
  import { useGameInfo } from "@/composition/useGameInfo";
  import type { LoadInput } from "@sveltejs/kit";
  import { useLoad } from "@/composition/useLoad";
  import { LoadGamesResult, useGames } from "@/composition/useGames";
  import { onMount } from "svelte";
  import GameListSidebar from "@/components/Layout/GameListSidebar.svelte";
  import { tick } from "svelte";

  const { activeGames } = useActiveGames();
  const { account } = useAccount();

  export let announcement: { title: string; content: string };
  export let firstGameInfo: LoadGamesResult;
  export let secondGameInfo: LoadGamesResult;

  let loaded = false;

  onMount(() => tick().then(() => (loaded = true)));
</script>

<div class="d-flex">
  <GameListSidebar />

  <div class="container">
    <div class="lead py-2" style="display: flex; flex-direction: column">
      <p class="text-center">
        Play <b>Gaia Project</b>, <b>Powergrid</b>, <b>6nimmt</b> and <b>Container</b> online<br />Want to set up live
        games? Join the
        <a href="https://discord.gg/EgqK3rD">discord</a>!
      </p>
      <div class="mx-auto card border-info px-3 pb-3 d-block">
        <div class="text-center announcement-title py-1">{announcement?.title}</div>
        <div class="text-start announcement-content">
          {@html marked(announcement?.content)}
        </div>
      </div>
    </div>
    <Row>
      <Col lg="6" class="mt-3">
        {#if $activeGames?.length}
          <GameList
            initial={!loaded && firstGameInfo}
            gameStatus="active"
            userId={$account?._id}
            perPage={5}
            title="My games"
          />
        {:else}
          <GameList
            initial={!loaded && firstGameInfo}
            gameStatus="active"
            topRecords
            perPage={5}
            title="Featured games"
          />
        {/if}
      </Col>
      <Col lg="6" class="mt-3">
        <GameList initial={!loaded && secondGameInfo} sample perPage={5} gameStatus="open" title="Lobby" />
      </Col>
    </Row>
    <div class="text-center mt-3">
      <a class="btn btn-secondary" href="/games" role="button">All games</a>
      <a class="btn btn-primary ms-3" href="/new-game" role="button">New Game</a>
    </div>
  </div>
</div>

<style>
  .lead {
    font-size: 1.25rem;
    font-weight: 300;
  }

  .announcement-title {
    font-weight: 400;
    font-size: 1rem;
  }

  :global(.announcement-content p) {
    margin-bottom: 0;
  }
</style>
