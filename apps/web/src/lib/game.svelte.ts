import type { IGame, PlayerInfoFront } from "@bgs/models";
import { get } from "./api";

export function loadGame(gameId: string) {
  return get<IGame>(`/gameplay/${gameId}`);
}

export function loadGamePlayers(gameId: string): Promise<PlayerInfoFront[]> {
  return get(`/game/${gameId}/players`);
}
