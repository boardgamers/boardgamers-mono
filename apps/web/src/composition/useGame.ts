export { loadGame, loadGamePlayers } from "@/lib/game.svelte";

import { loadGame, loadGamePlayers } from "@/lib/game.svelte";

export function useGame() {
  return { loadGame, loadGamePlayers };
}
