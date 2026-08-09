import type { PageLoad } from "./$types";
import { loadEloRankings } from "@/lib/elo-rankings.svelte";
import { gameLabel } from "@/utils/game-label";

export const load: PageLoad = async ({ params, parent }) => {
	const boardgameId = params.boardgameId;
	const currentPage = +params.page || 1;
	const skip = (currentPage - 1) * 15;
	const [parentData, rankings] = await Promise.all([parent(), loadEloRankings({ boardgameId, count: 15, skip })]);

	const label = gameLabel(parentData.gameInfo?.label ?? boardgameId);

	return {
		rankings,
		boardgameId,
		currentPage,
		skip,
		seo: {
			title: `${label} rankings`,
			description:
				rankings.rankings.length > 0
					? rankings.rankings.map((x, i) => `${skip + i + 1}° ${x.user.name} (${x.elo.value} elo)`).join("\n")
					: `Top ${label} players on Boardgamers.`,
		},
	};
};
