export { loadEloRankings, type EloRanking, type LoadEloRankingsResult } from "@/lib/elo-rankings.svelte";

import { loadEloRankings } from "@/lib/elo-rankings.svelte";

export function useEloRankings() {
  return { loadEloRankings };
}
