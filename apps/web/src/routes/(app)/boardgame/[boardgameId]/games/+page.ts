import type { PageLoad } from "./$types";
import { loadGames } from "@/lib/games.svelte";
import { setApiContext } from "@/lib/api";

export const load: PageLoad = async ({ params, fetch }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  const boardgameId = params.boardgameId;
  const firstTab = params.status !== "ended";

  const [featured, lobby] = await Promise.all([
    loadGames({ gameStatus: "active", boardgameId, store: true }),
    loadGames({ gameStatus: "open", boardgameId, store: true }),
  ]);

  return { featured, lobby, boardgameId, firstTab };
};
