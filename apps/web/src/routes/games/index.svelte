<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const boardgameId = input.page.params.boardgameId;
    const { loadGames } = useLoad(input, useGames);

    const [featured, lobby] = await Promise.all([
      loadGames({
        gameStatus: "active",
        boardgameId,
        store: true,
      }),
      loadGames({ gameStatus: "open", boardgameId, store: true }),
    ]);

    return { props: { featured, lobby, boardgameId } };
  }
</script>

<script lang="ts">
  import { fade } from "svelte/transition";
  import { GameList, SEO } from "@/components";
  import { Col, Container, Nav, NavItem, NavLink } from "@/modules/cdk";
  import { useLoad } from "@/composition/useLoad";
  import type { LoadInput } from "@sveltejs/kit";
  import { LoadGamesResult, useGames } from "@/composition/useGames";

  export let boardgameId: string | undefined;
  export let featured: LoadGamesResult;
  export let lobby: LoadGamesResult;

  let firstTab = true;
  let animating = false;

  let [featuredCount, lobbyCount] = [featured, lobby];
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
        <GameList gameStatus="open" title="Lobby" {boardgameId} />
      </Col>
      <Col md="6" class="mb-2">
        <GameList gameStatus="active" title="Ongoing" {boardgameId} />
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
        <GameList gameStatus="ended" title="Finished" {boardgameId} />
      </Col>
    </div>
  {/if}
</Container>
