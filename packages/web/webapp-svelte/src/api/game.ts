import type { IGame, PlayerInfo } from "@bgs/types";
import { get, post } from "./rest";

/**
 * Load game players - with Elo filled in even when the game is ongoing
 * @param gameId
 * @returns
 */
export async function loadGamePlayers(gameId: string): Promise<PlayerInfo[]> {
  return get(`/game/${gameId}/players`);
}

export async function loadGameData(gameId: string) {
  return get(`/gameplay/${gameId}`);
}

export async function unjoinGame(gameId: string) {
  return post(`/game/${gameId}/unjoin`);
}

export async function joinGame(gameId: string): Promise<IGame> {
  return post(`/game/${gameId}/join`);
}

export async function startGame(gameId: string, { playerOrder }: { playerOrder: string[] }): Promise<IGame> {
  return post(`/game/${gameId}/start`, { playerOrder });
}
