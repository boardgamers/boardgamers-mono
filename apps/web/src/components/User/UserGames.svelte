<script lang="ts">
  import type { Page } from "@sveltejs/kit";
  import { Card, Col, Row } from "@/modules/cdk";
  import { GameList } from "../Game";
  import { page } from "$app/stores";

  export let userId: string;

  $: filter = $page.url.searchParams.get("games") ?? "started";

  const generateAlternative = (page: Page) => {
    const query = new URLSearchParams(page.url.searchParams);

    query.set("games", filter === "open" ? "started" : "open");

    return query.toString();
  };

  $: alternativeRoute = "?" + generateAlternative($page);
</script>

<Card class="mt-4 border-secondary" header="Games">
  <Row>
    {#if filter === "started"}
      <Col lg={6}>
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
