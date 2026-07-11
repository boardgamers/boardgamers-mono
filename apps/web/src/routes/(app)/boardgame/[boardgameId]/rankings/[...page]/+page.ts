import type { PageLoad } from "./$types";
import { loadEloRankings } from "@/lib/elo-rankings.svelte";

export const load: PageLoad = async ({ params }) => {
  const boardgameId = params.boardgameId;
  const currentPage = +params.page || 1;
  const skip = (currentPage - 1) * 15;
  const rankings = await loadEloRankings({ boardgameId, count: 15, skip });

  return { rankings, boardgameId, currentPage, skip };
};
