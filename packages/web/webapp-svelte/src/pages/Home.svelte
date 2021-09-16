<script lang="typescript">
  import { get } from "@/api";
  import { Col, Row } from "sveltestrap";
  import { GameList } from "@/components";
  import { user, activeGames } from "@/store";
</script>

<div class="text-center container">
  <p class="lead py-2">
    {#await get("/site/announcement") then announcement}
      {@html announcement}
    {/await}
  </p>

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

<style>
  .lead {
    font-size: 1.25rem;
    font-weight: 300;
  }
</style>
