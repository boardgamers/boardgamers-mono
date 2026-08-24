<script lang="ts">
	import { BoardgameElo } from "@/components";
	import type { PageProps } from "./$types";
	import { m } from "@/lib/i18n/messages";

	let { data }: PageProps = $props();
</script>

<div class="container mx-auto px-4">
	<h1>{m.boardgame_rankings()}</h1>
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		<div>
			<BoardgameElo
				boardgameId={data.boardgameId}
				initial={data.rankings}
				perPage={15}
				currentPage={data.currentPage - 1}
				serverPagination
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
