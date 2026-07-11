import type { GameFront, PlayerInfoFront } from "@bgs/models";
import { get } from "./api";

export function loadGame(gameId: string) {
  return get<GameFront>(`/gameplay/${gameId}`);
}

export function loadGamePlayers(gameId: string): Promise<PlayerInfoFront[]> {
  return get(`/game/${gameId}/players`);
}
