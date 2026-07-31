<script lang="ts">
  import { fade } from "svelte/transition";
  import { GameList, SEO } from "@/components";
  import { Nav, NavItem, NavLink, Input } from "@/modules/cdk";
  import type { LoadGamesResult } from "@/lib/games.svelte";
  import { debounce } from "lodash";

  let { data }: { data: { featured: LoadGamesResult; lobby: LoadGamesResult; boardgameId: string | undefined } } = $props();

  let firstTab = $state(true);
  let animating = $state(false);

  let featuredCount = $derived(data.featured);
  let lobbyCount = $derived(data.lobby);

  // Text filter (debounced) — filters by game id server-side across the full list.
  let searchInput = $state("");
  let search = $state<string | undefined>(undefined);
  const applySearch = debounce((val: string) => {
    search = val.trim() || undefined;
  }, 300);
  $effect(() => {
    applySearch(searchInput);
  });
</script>

<SEO title="All games" description={`${featuredCount} ongoing games and ${lobbyCount} open games.`} />

<div class="container mx-auto px-4">
  <div class="flex flex-wrap items-center gap-3">
    <Nav pills class="flex-1">
      <h1 class="me-3">Games</h1>
      <NavItem><NavLink href="#" onclick={() => (firstTab = true)} active={firstTab}>Active</NavLink></NavItem>
      <NavItem><NavLink href="#" onclick={() => (firstTab = false)} active={!firstTab}>Finished</NavLink></NavItem>
    </Nav>
    <div class="w-full sm:w-64">
      <Input type="search" placeholder="Filter by game name…" bind:value={searchInput} aria-label="Filter games by name" />
    </div>
  </div>

  {#if firstTab}
    <div
      class="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2"
      transition:fade
      onoutroend={() => (animating = false)}
      onoutrostart={() => (animating = true)}
      class:hidden={animating}
    >
      <div class="mb-2">
        <GameList gameStatus="open" title="Lobby" boardgameId={data.boardgameId} {search} />
      </div>
      <div class="mb-2">
        <GameList gameStatus="active" title="Ongoing" boardgameId={data.boardgameId} {search} />
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
        <GameList gameStatus="ended" title="Finished" boardgameId={data.boardgameId} {search} />
      </div>
    </div>
  {/if}
</div>
