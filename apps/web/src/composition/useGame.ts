import type { IGame, PlayerInfoFront } from "@bgs/models";
import { defineStore } from "./defineStore";
import { useRest } from "./useRest";

export const useGame = defineStore(() => {
  const { get } = useRest();

  function loadGame(gameId: string) {
    return get<IGame>(`/gameplay/${gameId}`);
  }

  function loadGamePlayers(gameId: string): Promise<PlayerInfoFront[]> {
    return get(`/game/${gameId}/players`);
  }

  return { loadGame, loadGamePlayers };
});
