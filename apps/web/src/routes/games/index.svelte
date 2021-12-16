<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const boardgameId = input.page.params.boardgameId;
    const { loadGames } = useLoad(input, useGames);

    const firstTab = input.page.params.status !== "ended";

    const [featured, lobby, finished] = await Promise.all([
      firstTab
        ? loadGames({
            gameStatus: "active",
            boardgameId,
          })
        : undefined,
      firstTab ? loadGames({ gameStatus: "open", boardgameId }) : undefined,
      firstTab ? undefined : loadGames({ gameStatus: "ended", boardgameId }),
    ]);

    return { props: { featured, lobby, boardgameId, firstTab, finished } };
  }
</script>

<script lang="ts">
  import { fade } from "svelte/transition";
  import { GameList, SEO } from "@/components";
  import { Col, Container, Nav, NavItem, NavLink } from "@/modules/cdk";
  import { useLoad } from "@/composition/useLoad";
  import type { LoadInput } from "@sveltejs/kit";
  import { LoadGamesResult, useGames } from "@/composition/useGames";
  import { onMount } from "svelte";

  export let boardgameId: string | undefined;
  export let featured: LoadGamesResult | undefined;
  export let lobby: LoadGamesResult | undefined;
  export let finished: LoadGamesResult | undefined;
  export let firstTab: boolean;

  let animating = false;

  let [featuredCount, lobbyCount] = [featured!.games, lobby!.total];

  onMount(() => (featured = lobby = undefined));
</script>

<SEO title="All games" description={`${featuredCount} ongoing games and ${lobbyCount} open games.`} />

<Container>
  <Nav pills>
    <h1 class="me-3">Games</h1>
    <NavItem><NavLink href="#" on:click={() => (firstTab = true)} active={firstTab}>Active</NavLink></NavItem>
    <NavItem><NavLink href="#" on:click={() => (firstTab = false)} active={!firstTab}>Finished</NavLink></NavItem>
  </Nav>

  {#if firstTab}
    <div
      class="mt-2 row"
      transition:fade
      on:outroend={() => (animating = false)}
      on:outrostart={() => (animating = true)}
      class:d-none={animating}
    >
      <Col md="6" class="mb-2">
        <GameList gameStatus="open" title="Lobby" {boardgameId} initial={lobby} />
      </Col>
      <Col md="6" class="mb-2">
        <GameList gameStatus="active" title="Ongoing" {boardgameId} initial={featured} />
      </Col>
    </div>
  {:else}
    <div
      class="mt-2 row"
      transition:fade
      on:outroend={() => (animating = false)}
      on:outrostart={() => (animating = true)}
      class:d-none={animating}
    >
      <Col md="6" class="mb-2">
        <GameList gameStatus="ended" title="Finished" {boardgameId} initial={finished} />
      </Col>
    </div>
  {/if}
</Container>
