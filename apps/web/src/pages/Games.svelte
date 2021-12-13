<script lang="ts">
  import { fade } from "svelte/transition";
  import { GameList } from "@/components";
  import { Col, Container, Nav, NavItem, NavLink, Row } from "@/modules/cdk";
  import { route } from "@/modules/router";

  export let boardgameId: string;
  let firstTab: boolean;

  let animating = false;

  $: firstTab = $route!.hash !== "open";
</script>

<Container>
  <Nav pills>
    <h1 class="me-3">Games</h1>
    <NavItem><NavLink href="#started" active={firstTab}>Started</NavLink></NavItem>
    <NavItem><NavLink href="#open" active={!firstTab}>Open</NavLink></NavItem>
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
        <GameList gameStatus="active" title="Active" {boardgameId} />
      </Col>
      <Col md="6" class="mb-2">
        <GameList gameStatus="ended" title="Finished" {boardgameId} />
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
        <GameList gameStatus="open" title="Open" {boardgameId} />
      </Col>
    </div>
  {/if}
</Container>
