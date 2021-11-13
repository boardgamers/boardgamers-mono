<script lang="ts">
  import { Card, Col, Row } from "@/modules/cdk";
  import { route } from "@/modules/router";
  import GameList from "../Game/components/GameList.svelte";

  export let userId: string;

  $: filter = $route?.query.games ?? "started";
  $: alternativeRoute =
    "?" + new URLSearchParams({ ...$route?.query, games: filter === "open" ? "started" : "open" }).toString();
</script>

<Card class="mt-4 border-info" header="Games">
  <Row>
    {#if filter === "started"}
      <Col lg={6} class="mb-3">
        <GameList gameStatus="active" perPage={5} {userId} title="Active games" />
      </Col>
      <Col lg={6}>
        <GameList gameStatus="ended" perPage={5} {userId} title="Finished games" />
      </Col>
    {:else}
      <Col lg={6}>
        <GameList gameStatus="open" perPage={5} {userId} title="Open games" />
      </Col>
    {/if}
  </Row>
  <a slot="footer" href={alternativeRoute}>
    {filter === "started" ? "Open games" : "Started games"}
  </a>
</Card>
