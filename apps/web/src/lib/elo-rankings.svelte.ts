import { get } from "./api";

export type EloRanking = {
  user: {
    name: string;
    _id: string;
  };
  elo: {
    value: number;
    games: number;
  };
};

export type LoadEloRankingsResult = {
  total: number;
  rankings: EloRanking[];
};

export async function loadEloRankings({
  boardgameId,
  count = 0,
  skip = 0,
  fetchCount = true,
}: {
  boardgameId: string;
  count?: number;
  skip?: number;
  fetchCount?: boolean;
}) {
  const [rankings, total] = await Promise.all([
    get<EloRanking[]>(`/boardgame/${boardgameId}/elo`, { skip, count }),
    fetchCount ? get<number>(`/boardgame/${boardgameId}/elo/count`) : 0,
  ]);

  return {
    rankings,
    total,
  };
}
