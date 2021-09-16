<script lang="ts">
  import { Card, Col, Row } from "@/modules/cdk";
  import GameList from "../Game/components/GameList.svelte";

  export let userId: string;
</script>

<Card class="mt-4 border-info" header="Games">
  <Row>
    <Col lg={6} class="mb-3">
      <GameList gameStatus="active" perPage={5} {userId} title="Active games" />
    </Col>
    <Col lg={6}>
      <GameList gameStatus="ended" perPage={5} {userId} title="Finished games" />
    </Col>
  </Row>
</Card>
