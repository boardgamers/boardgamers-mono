<script lang="ts">
  import { SEO, GameListSidebar } from "@/components";
  import { Button } from "@/modules/cdk";
  import marked from "marked";
  import GameList from "@/components/Game/GameList.svelte";
  import { activeGames } from "@/lib/stores.svelte";
  import { account } from "@/lib/account.svelte";
  let { data } = $props();
  let announcement = $derived(data.announcement);
</script>

<SEO />

<div class="flex">
  <GameListSidebar />

  <div class="container mx-auto px-4">
    <div class="flex flex-col py-2 text-lg font-light">
      <p class="text-center">
        Play <b><a class="no-link text-accent" href="/boardgame/gaia-project">Gaia Project</a></b>,
        <b><a class="no-link text-accent" href="/boardgame/powergrid">Powergrid</a></b>,
        <b><a class="no-link text-accent" href="/boardgame/take6">6nimmt</a></b>
        and <b><a class="no-link text-accent" href="/boardgame/container">Container</a></b> online<br />Want to set up
        live games? Join the
        <a href="https://discord.gg/EgqK3rD">discord</a>!
      </p>
      <div class="mx-auto block w-fit rounded-md border border-accent px-3 pb-3">
        <div class="py-1 text-center text-base font-normal">{data.announcement?.title}</div>
        <div class="text-left announcement-content">
          {@html marked(data.announcement?.content || "")}
        </div>
      </div>
    </div>
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="mt-3">
        {#if $activeGames?.length}
          <GameList gameStatus="active" userId={$account?._id} perPage={5} title="My games" />
        {:else}
          <GameList gameStatus="active" topRecords perPage={5} title="Featured games" />
        {/if}
      </div>
      <div class="mt-3">
        <GameList sample perPage={5} gameStatus="open" title="Lobby" />
      </div>
    </div>
    <div class="mt-3 text-center">
      <Button color="accent" href="/games">All games</Button>
      <Button color="primary" class="ms-3" href="/new-game" data-sveltekit-preload-data="hover"
        >New Game</Button
      >
    </div>
  </div>
</div>

<style>
  :global(.announcement-content p) {
    margin-bottom: 0;
  }
</style>
