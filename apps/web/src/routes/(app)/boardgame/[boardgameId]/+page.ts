import type { PageLoad } from "./$types";
import { loadGames } from "@/lib/games.svelte";
import { loadEloRankings } from "@/lib/elo-rankings.svelte";
import { setApiContext } from "@/lib/api";

export const load: PageLoad = async ({ params, fetch, parent }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  const { user } = await parent();
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

  // Featured games (no userId filter) — only needed when logged in, since when
  // logged out the myGames query already has no userId and hits the same cache key.
  const featuredGames = userId
    ? loadGames({ gameStatus: "active", count: 5, boardgameId, fetchCount: false, store: true })
    : undefined;

  const lobbyGames = loadGames({ sample: true, gameStatus: "open", boardgameId, count: 5, store: true });

  const [_1, _2, _3, rankings] = await Promise.all([
    myGames,
    featuredGames,
    lobbyGames,
    loadEloRankings({ boardgameId, count: 6, fetchCount: false }),
  ]);

  return { rankings };
};
