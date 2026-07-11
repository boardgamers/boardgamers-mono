export { currentGameId, lastGameUpdate, playerStatus } from "@/lib/stores.svelte";

import { currentGameId, lastGameUpdate, playerStatus } from "@/lib/stores.svelte";

export function useCurrentGame() {
  return { currentGameId, lastGameUpdate, playerStatus };
}
