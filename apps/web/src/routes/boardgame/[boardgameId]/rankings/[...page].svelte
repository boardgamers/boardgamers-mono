<script context="module" lang="ts">
  export async function load(input: LoadInput) {
    const boardgameId = input.page.params.boardgameId;
    const currentPage = +input.page.params.page || 1;
    const { loadEloRankings } = useLoad(input, useEloRankings);
    const rankings = await loadEloRankings({ boardgameId, count: 15, skip: (currentPage - 1) * 15 });

    return { props: { rankings, boardgameId, currentPage } };
  }
</script>

<script lang="ts">
  import { BoardgameElo } from "@/components";
  import { LoadEloRankingsResult, useEloRankings } from "@/composition/useEloRankings";
  import { useLoad } from "@/composition/useLoad";
  import { Col, Row } from "@/modules/cdk";
  import type { LoadInput } from "@sveltejs/kit";

  export let rankings: LoadEloRankingsResult;
  export let boardgameId: string;
  export let currentPage: number;
</script>

<div class="container">
  <h1>Rankings</h1>
  <Row>
    <Col md={6}>
      <BoardgameElo
        {boardgameId}
        initial={rankings}
        perPage={15}
        currentPage={currentPage - 1}
        baseUrl={`/boardgame/${boardgameId}/rankings`}
      />
    </Col>
    <!--
    <b-col md="6">
      <h3>Tournaments</h3>
      <p>No Tournament ranking available</p>
    </b-col>
-->
  </Row>
</div>
