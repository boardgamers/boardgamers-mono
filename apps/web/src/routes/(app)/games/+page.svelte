<script lang="ts">
  import { fade } from "svelte/transition";
  import { GameList, SEO } from "@/components";
  import { Col, Container, Nav, NavItem, NavLink } from "@/modules/cdk";
  import { useGameInfo } from "@/composition/useGameInfo";
  import type { LoadGamesResult } from "@/composition/useGames";

  let { data }: { data: { featured: LoadGamesResult; lobby: LoadGamesResult; boardgameId: string | undefined } } = $props();

  let firstTab = true;
  let animating = false;

  let featuredCount = data.featured;
  let lobbyCount = data.lobby;
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
        <GameList gameStatus="open" title="Lobby" boardgameId={data.boardgameId} />
      </Col>
      <Col md="6" class="mb-2">
        <GameList gameStatus="active" title="Ongoing" boardgameId={data.boardgameId} />
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
        <GameList gameStatus="ended" title="Finished" boardgameId={data.boardgameId} />
      </Col>
    </div>
  {/if}
</Container>
