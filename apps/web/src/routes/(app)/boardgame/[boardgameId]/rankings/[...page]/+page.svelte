<script lang="ts">
	import { BoardgameElo, SEO } from "@/components";
	import { useGameInfo } from "@/lib/game-info.svelte";
	import { gameLabel } from "@/utils/game-label";
	import type { PageProps } from "./$types";

	let { data }: PageProps = $props();

	const gameInfo = useGameInfo(data.boardgameId, "latest");
</script>

<SEO
	title={`Page ${data.currentPage} - ${gameLabel(gameInfo?.label ?? data.boardgameId)} rankings`}
	description={data.rankings.rankings
		.map((x, i) => `${data.skip + i + 1}° ${x.user.name} (${x.elo.value} elo)`)
		.join("\n")}
/>

<div class="container mx-auto px-4">
	<h1>Rankings</h1>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<div>
			<BoardgameElo
				boardgameId={data.boardgameId}
				initial={data.rankings}
				perPage={15}
				currentPage={data.currentPage - 1}
				baseUrl={`/boardgame/${data.boardgameId}/rankings`}
			/>
		</div>
		<!--
    <b-col md="6">
      <h3>Tournaments</h3>
      <p>No Tournament ranking available</p>
    </b-col>
-->
	</div>
</div>
