<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const boardgameId = input.params.boardgameId;
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
  import { Col, Container, Nav, NavItem, NavLink } from "$cdk";
  import { LoadGamesResult, useGames } from "$lib/composition/useGames";
  import { useLoad } from "$lib/composition/useLoad";
  import { GameList, SEO } from "@/components";
  import type { LoadInput } from "@sveltejs/kit";
  import { fade } from "svelte/transition";

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
    <NavItem><NavLink href="#" onclick={() => (firstTab = true)} active={firstTab}>Active</NavLink></NavItem>
    <NavItem><NavLink href="#" onclick={() => (firstTab = false)} active={!firstTab}>Finished</NavLink></NavItem>
  </Nav>

  {#if firstTab}
    <div
      class="mt-2 row"
      transition:fade
      onoutroend={() => (animating = false)}
      onoutrostart={() => (animating = true)}
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
      onoutroend={() => (animating = false)}
      onoutrostart={() => (animating = true)}
      class:d-none={animating}
    >
      <Col md="6" class="mb-2">
        <GameList gameStatus="ended" title="Finished" {boardgameId} />
      </Col>
    </div>
  {/if}
</Container>
