import type { PageLoad } from "./$types";
import { loadGames } from "@/lib/games.svelte";

export const load: PageLoad = async ({ params }) => {
  const boardgameId = params.boardgameId;

  const [featured, lobby] = await Promise.all([
    loadGames({ gameStatus: "active", boardgameId, store: true }),
    loadGames({ gameStatus: "open", boardgameId, store: true }),
  ]);

  return { featured, lobby, boardgameId };
};
