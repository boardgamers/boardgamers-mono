<script lang="ts">
  import { fade } from "svelte/transition";
  import { GameList, SEO } from "@/components";
  import { Nav, NavItem, NavLink } from "@/modules/cdk";
  import type { LoadGamesResult } from "@/lib/games.svelte";

  let { data }: { data: { featured: LoadGamesResult; lobby: LoadGamesResult; boardgameId: string | undefined } } = $props();

  let firstTab = $state(true);
  let animating = $state(false);

  let featuredCount = $derived(data.featured);
  let lobbyCount = $derived(data.lobby);
</script>

<SEO title="All games" description={`${featuredCount} ongoing games and ${lobbyCount} open games.`} />

<div class="container mx-auto px-4">
  <Nav pills>
    <h1 class="me-3">Games</h1>
    <NavItem><NavLink href="#" onclick={() => (firstTab = true)} active={firstTab}>Active</NavLink></NavItem>
    <NavItem><NavLink href="#" onclick={() => (firstTab = false)} active={!firstTab}>Finished</NavLink></NavItem>
  </Nav>

  {#if firstTab}
    <div
      class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2"
      transition:fade
      onoutroend={() => (animating = false)}
      onoutrostart={() => (animating = true)}
      class:hidden={animating}
    >
      <div class="mb-2">
        <GameList gameStatus="open" title="Lobby" boardgameId={data.boardgameId} />
      </div>
      <div class="mb-2">
        <GameList gameStatus="active" title="Ongoing" boardgameId={data.boardgameId} />
      </div>
    </div>
  {:else}
    <div
      class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2"
      transition:fade
      onoutroend={() => (animating = false)}
      onoutrostart={() => (animating = true)}
      class:hidden={animating}
    >
      <div class="mb-2">
        <GameList gameStatus="ended" title="Finished" boardgameId={data.boardgameId} />
      </div>
    </div>
  {/if}
</div>
