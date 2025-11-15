import type { GameStatus, IGame } from "@bgs/types";
import { get as $ } from "svelte/store";
import { defineStore } from "./defineStore";
import { useAccount } from "./useAccount";
import { useGameInfo } from "./useGameInfo";
import { useRest } from "./useRest";

type LoadGamesParams = {
  boardgameId?: string;
  userId?: string | null;
  sample?: boolean;
  skip?: number;
  count?: number;
  minDuration?: number;
  maxDuration?: number;
  gameStatus: GameStatus;
  fetchCount?: boolean;
  store?: boolean; // To store the result in cache, next time function is called with same params it will return the cached value
};

export type LoadGamesResult = {
  games: IGame[];
  total: number;
};

export const useGames = defineStore(() => {
  const { get } = useRest();
  const { account } = useAccount();
  const { loadGameInfo, gameInfo } = useGameInfo();

  const gamesCache = new Map<string, LoadGamesResult>();

  const loadGames = ({
    count = 10,
    skip = 0,
    minDuration,
    maxDuration,
    sample,
    userId,
    boardgameId,
    gameStatus,
    fetchCount = !sample,
    store = false,
  }: LoadGamesParams) => {
    const queryParams = {
      count,
      skip,
      ...(sample && { sample: true }),
      ...(userId && { user: userId }),
      ...(boardgameId && { boardgame: boardgameId }),
      ...(gameStatus === "open" && !!$(account)?._id && { maxKarma: $(account)!.account.karma }),
      ...(minDuration && { minDuration }),
      ...(maxDuration && { maxDuration }),
    };

    const key = JSON.stringify({ ...queryParams, gameStatus, fetchCount });

    if (!store && gamesCache.has(key)) {
      // console.log("got ", key);
      try {
        return gamesCache.get(key)!;
      } finally {
        gamesCache.delete(key);
      }
    }

    return Promise.all([
      get<IGame[]>(`/game/status/${gameStatus}`, queryParams),
      fetchCount ? get<number>(`/game/status/${gameStatus}/count`, queryParams) : 0,
    ]).then(async ([games, total]) => {
      const missingGameInfos = games.map((game) => game.game.name).filter((boardgameId) => !gameInfo(boardgameId));
      if (missingGameInfos.length > 0) {
        await Promise.all(missingGameInfos.map((boardgameId) => loadGameInfo(boardgameId)));
      }

      if (store) {
        // console.log("storing", key);
        gamesCache.set(key, { games, total });
      }

      return { games, total };
    });
  };

  return {
    loadGames,
  };
});
