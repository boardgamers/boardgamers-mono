import type { GameStatus, IGame } from "@bgs/types";
import { get as $ } from "svelte/store";
import { defineStore } from "./defineStore";
import { useAccount } from "./useAccount";
import { useRest } from "./useRest";

type LoadGamesParams = {
  boardgameId?: string;
  userId?: string;
  sample?: boolean;
  skip?: number;
  count?: number;
  gameStatus: GameStatus;
  fetchCount?: boolean;
};

export type LoadGamesResult = {
  games: IGame[];
  total: number;
};

export const useGames = defineStore(() => {
  const { get } = useRest();
  const { account } = useAccount();

  const loadGames = async ({
    count = 10,
    skip = 0,
    sample,
    userId,
    boardgameId,
    gameStatus,
    fetchCount = !sample,
  }: LoadGamesParams) => {
    const queryParams = {
      count,
      skip,
      ...(sample && { sample: true }),
      ...(userId && { user: userId }),
      ...(boardgameId && { boardgame: boardgameId }),
      ...(gameStatus === "open" && !!$(account)?._id && { maxKarma: $(account)!.account.karma }),
    };

    const [games, total] = await Promise.all([
      get<IGame[]>(`/game/status/${gameStatus}`, queryParams),
      fetchCount ? await get<number>(`/game/status/${gameStatus}/count`, queryParams) : 0,
    ]);

    return {
      games,
      total,
    };
  };

  return {
    loadGames,
  };
});
