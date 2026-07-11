export { loadGames, type LoadGamesResult, type LoadGamesParams } from "@/lib/games.svelte";

import { loadGames } from "@/lib/games.svelte";

export function useGames() {
  return { loadGames };
}
