import type { PageLoad } from "./$types";
import { get as $ } from "svelte/store";
import { get, setApiContext } from "@/lib/api";
import { account } from "@/lib/stores.svelte";
import { activeGames } from "@/lib/active-games.svelte";
import { loadGames } from "@/lib/games.svelte";
import { loadGameInfos } from "@/lib/game-info.svelte";

export const load: PageLoad = async ({ fetch }) => {
  setApiContext((prev) => ({ ...prev, fetch }));
  const firstGames = loadGames({
    gameStatus: "active",
    count: 5,
    store: true,
    ...($(activeGames).length > 0 ? { userId: $(account)?._id ?? null } : { fetchCount: false }),
  });
  const secondGames = loadGames({ sample: true, gameStatus: "open", count: 5, store: true });

  await loadGameInfos();
  await Promise.all([firstGames, secondGames]);

  return {
    announcement: await get<{ title: string; content: string }>("/site/announcement"),
  };
};
