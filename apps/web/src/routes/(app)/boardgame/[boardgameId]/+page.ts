import type { PageLoad } from "./$types";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import { loadEloRankings } from "@/lib/elo-rankings.svelte";
import { setApiContext } from "@/lib/api";

export const load: PageLoad = async ({ params, fetch, parent }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  const { user } = await parent();

  // Clear stale cache from previous navigation so GameList components always
  // see fresh data from this page's pre-fetched results.
  clearGamesCache();
  const boardgameId = params.boardgameId;
  const userId = user?._id;

  const myGames = loadGames({
    gameStatus: "active",
    count: 5,
    boardgameId,
    userId,
    fetchCount: false,
    store: true,
  });

  const featuredGames = loadGames({ gameStatus: "active", count: 5, boardgameId, fetchCount: false, store: true });

  const lobbyGames = loadGames({ sample: true, gameStatus: "open", boardgameId, count: 5, store: true });

  const [_1, _2, _3, rankings] = await Promise.all([
    myGames,
    featuredGames,
    lobbyGames,
    loadEloRankings({ boardgameId, count: 6, fetchCount: false }),
  ]);

  return { rankings };
};
