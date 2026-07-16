import type { GameStatus, GameFront } from "@bgs/models";
import { get as getStore } from "svelte/store";
import { account } from "./stores.svelte";
import { gameInfo, loadGameInfo } from "./game-info.svelte";
import { get } from "./api";

export type LoadGamesParams = {
  boardgameId?: string;
  userId?: string | null;
  sample?: boolean;
  skip?: number;
  count?: number;
  minDuration?: number;
  maxDuration?: number;
  gameStatus: GameStatus;
  fetchCount?: boolean;
  store?: boolean;
};

export type LoadGamesResult = {
  games: GameFront[];
  total: number;
};

const gamesCache = new Map<string, LoadGamesResult>();

/** Clear cached game results. Called from +page.ts load functions to prevent
 *  stale data from a previous navigation being served on the new page. */
export function clearGamesCache() {
  gamesCache.clear();
}

export function loadGames({
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
}: LoadGamesParams) {
  const queryParams = {
    count,
    skip,
    ...(sample && { sample: true }),
    ...(userId && { user: userId }),
    ...(boardgameId && { boardgame: boardgameId }),
    ...(gameStatus === "open" && !!getStore(account)?._id && { maxKarma: getStore(account)!.account.karma }),
    ...(minDuration && { minDuration }),
    ...(maxDuration && { maxDuration }),
  };

  const key = JSON.stringify({ ...queryParams, gameStatus, fetchCount });

  if (!store && gamesCache.has(key)) {
    return gamesCache.get(key)!;
  }

  return Promise.all([
    get<GameFront[]>(`/game/status/${gameStatus}`, queryParams),
    fetchCount ? get<number>(`/game/status/${gameStatus}/count`, queryParams) : 0,
  ]).then(async ([games, total]) => {
    const missingGameInfos = games.map((game) => game.game.name).filter((boardgameId) => !gameInfo(boardgameId));
    if (missingGameInfos.length > 0) {
      await Promise.all(missingGameInfos.map((boardgameId) => loadGameInfo(boardgameId)));
    }

    if (store) {
      gamesCache.set(key, { games, total });
    }

    return { games, total };
  });
}
