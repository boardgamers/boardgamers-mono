<!-- This file is copied from ../../games/index.svelte-->
<script lang="ts">
  import { fade } from "svelte/transition";
  import { GameList, SEO } from "@/components";
  import { Col, Container, Nav, NavItem, NavLink } from "@/modules/cdk";
  import type { LoadGamesResult } from "@/lib/games.svelte";
  import { gameInfo } from "@/lib/game-info.svelte";

  let {
    data,
  }: {
    data: {
      boardgameId: string;
      featured: LoadGamesResult;
      lobby: LoadGamesResult;
      firstTab: boolean;
    };
  } = $props();

  import { untrack } from "svelte";
  // One-shot init from SSR data — firstTab is a user-toggled local state
  let firstTab = $state(untrack(() => data.firstTab));

  let animating = $state(false);
  let featuredCount = $derived(data.featured?.games ?? []);
  let lobbyCount = $derived(data.lobby?.total ?? 0);
</script>

<SEO
  title={`${gameInfo(data.boardgameId, "latest").label} games`}
  description={`${featuredCount} ongoing games and ${lobbyCount} open games.`}
/>

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
      onoutroend={() => (animating = false)}
      onoutrostart={() => (animating = true)}
      class:d-none={animating}
    >
      <Col md="6" class="mb-2">
        <GameList gameStatus="ended" title="Finished" boardgameId={data.boardgameId} />
      </Col>
    </div>
  {/if}
</Container>
