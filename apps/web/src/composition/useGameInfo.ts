export { gameInfos, loadGameInfos, gameInfo, gameInfoKey, latestGameInfos, loadGameInfo } from "@/lib/game-info.svelte";

import { gameInfos, loadGameInfos, gameInfo, gameInfoKey, latestGameInfos, loadGameInfo } from "@/lib/game-info.svelte";

export function useGameInfo() {
  return {
    gameInfos,
    loadGameInfos,
    gameInfo,
    gameInfoKey,
    latestGameInfos,
    loadGameInfo,
  };
}
