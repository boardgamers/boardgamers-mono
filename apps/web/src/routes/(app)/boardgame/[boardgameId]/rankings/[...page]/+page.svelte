<script lang="ts">
  import { BoardgameElo, SEO } from "@/components";
  import type { LoadEloRankingsResult } from "@/composition/useEloRankings";
  import { useGameInfo } from "@/composition/useGameInfo";
  import { Col, Row } from "@/modules/cdk";
  import { gameLabel } from "@/utils/game-label";

  const { gameInfo } = useGameInfo();

  let { data }: { data: { rankings: LoadEloRankingsResult; boardgameId: string; currentPage: number; skip: number } } =
    $props();
</script>

<SEO
  title={`Page ${data.currentPage} - ${gameLabel(gameInfo(data.boardgameId, "latest").label)} rankings`}
  description={data.rankings.rankings
    .map((x, i) => `${data.skip + i + 1}° ${x.user.name} (${x.elo.value} elo)`)
    .join("\n")}
/>

<div class="container">
  <h1>Rankings</h1>
  <Row>
    <Col md={6}>
      <BoardgameElo
        boardgameId={data.boardgameId}
        initial={data.rankings}
        perPage={15}
        currentPage={data.currentPage - 1}
        baseUrl={`/boardgame/${data.boardgameId}/rankings`}
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
