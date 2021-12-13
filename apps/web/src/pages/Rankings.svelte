<script lang="ts">
  import { BoardgameElo } from "@/components";
  import { Col, Row } from "@/modules/cdk";

  export let boardgameId: string;
</script>

<div class="container">
  <h1>Rankings</h1>
  <Row>
    <Col md={6}>
      <BoardgameElo {boardgameId} perPage={10} />
    </Col>
    <!--
    <b-col md="6">
      <h3>Tournaments</h3>
      <p>No Tournament ranking available</p>
    </b-col>
-->
  </Row>
</div>
