export { activeGames, addActiveGame, removeActiveGame, loadActiveGames } from "@/lib/active-games.svelte";

import { activeGames, addActiveGame, removeActiveGame, loadActiveGames } from "@/lib/active-games.svelte";

export function useActiveGames() {
  return { activeGames, addActiveGame, removeActiveGame, loadActiveGames };
}
