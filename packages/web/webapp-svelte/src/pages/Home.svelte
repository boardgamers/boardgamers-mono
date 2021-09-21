<script lang="ts">
  import { get } from "@/api";
  import { Col, Row } from "sveltestrap";
  import { GameList } from "@/components";
  import { user, activeGames } from "@/store";
  import marked from "marked";

  async function loadAnnouncement(): Promise<{ title: string; content: string }> {
    return get("/site/announcement");
  }
</script>

<div class="container">
  <div class="lead py-2" style="display: flex; flex-direction: column">
    {#await loadAnnouncement() then announcement}
      <p class="text-center">
        Play <b>Gaia Project</b> and <b>Container</b> online<br />Want to set up live games? Join the
        <a href="https://discord.gg/EgqK3rD">discord</a>!
      </p>
      <div class="mx-auto card border-info px-3 pb-3 d-block">
        <div class="text-center announcement-title py-1">{announcement?.title}</div>
        <div class="text-start announcement-content">
          {@html marked(announcement?.content)}
        </div>
      </div>
    {/await}
  </div>

  <Row>
    <Col lg="6" class="mt-3">
      {#if $activeGames?.length}
        <GameList gameStatus="active" userId={$user?._id} perPage={5} title="My games" />
      {:else}
        <GameList gameStatus="active" topRecords perPage={5} title="Featured games" />
      {/if}
    </Col>
    <Col lg="6" class="mt-3">
      <GameList sample perPage={5} gameStatus="open" title="Lobby" />
    </Col>
  </Row>
  <div class="text-center mt-3">
    <a class="btn btn-secondary" href="/games" role="button">All games</a>
    <a class="btn btn-primary ms-3" href="/new-game" role="button">New Game</a>
  </div>
</div>

<style lang="postcss">
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
