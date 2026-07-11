import { get as $ } from "svelte/store";
import type { PageLoad } from "./$types";
import { account } from "@/lib/stores.svelte";
import { loadGames } from "@/lib/games.svelte";
import { loadEloRankings } from "@/lib/elo-rankings.svelte";
import { setApiContext } from "@/lib/api";

export const load: PageLoad = async ({ params, fetch }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  const boardgameId = params.boardgameId;
  const userId = $(account)?._id;

  const featuredGames = loadGames({
    gameStatus: "active",
    count: 5,
    boardgameId,
    fetchCount: false,
    store: true,
  });

  const myGames = loadGames({
    gameStatus: "active",
    count: 5,
    boardgameId,
    userId,
    fetchCount: false,
    store: true,
  });

  const lobbyGames = loadGames({ sample: true, gameStatus: "open", boardgameId, count: 5, store: true });

  const [_1, _2, _3, rankings] = await Promise.all([
    featuredGames,
    myGames,
    lobbyGames,
    loadEloRankings({ boardgameId, count: 6, fetchCount: false }),
  ]);

  return { rankings };
};
