import type { IGame, PlayerInfo } from "@bgs/types";
import { defineStore } from "./defineStore";
import { useRest } from "./useRest";

export const useGame = defineStore(() => {
  const { get } = useRest();

  function loadGame(gameId: string) {
    return get<IGame>(`/gameplay/${$(gameId)}`);
  }

  function loadGamePlayers(gameId: string): Promise<PlayerInfo[]> {
    return get(`/game/${gameId}/players`);
  }

  return { loadGame, loadGamePlayers };
});
