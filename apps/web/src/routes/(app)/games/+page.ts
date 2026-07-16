import type { PageLoad } from "./$types";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import { setApiContext } from "@/lib/api";

export const load: PageLoad = async ({ params, fetch }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  clearGamesCache();
  const boardgameId = params.boardgameId;

  const [featured, lobby] = await Promise.all([
    loadGames({ gameStatus: "active", boardgameId, store: true }),
    loadGames({ gameStatus: "open", boardgameId, store: true }),
  ]);

  return { featured, lobby, boardgameId };
};
