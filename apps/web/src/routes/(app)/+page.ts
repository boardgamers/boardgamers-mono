import type { PageLoad } from "./$types";
import { get, setApiContext } from "@/lib/api";
import { loadGames } from "@/lib/games.svelte";
import { loadGameInfos } from "@/lib/game-info.svelte";

export const load: PageLoad = async ({ fetch, parent }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  const { user, activeGames } = await parent();

  const firstGames = loadGames({
    gameStatus: "active",
    count: 5,
    store: true,
    ...(activeGames.length > 0 ? { userId: user?._id ?? null } : { fetchCount: false }),
  });
  const secondGames = loadGames({ sample: true, gameStatus: "open", count: 5, store: true });

  await loadGameInfos();
  await Promise.all([firstGames, secondGames]);

  return {
    announcement: await get<{ title: string; content: string }>("/site/announcement"),
  };
};
