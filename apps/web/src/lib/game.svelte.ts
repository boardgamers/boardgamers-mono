import type { GameFront, PlayerInfoFront } from "@bgs/models";
import { get } from "./api";

export function loadGame(gameId: string) {
	return get<GameFront>(`/gameplay/${gameId}`);
}

export function loadGamePlayers(gameId: string): Promise<PlayerInfoFront[]> {
	return get(`/game/${gameId}/players`);
}

/**
 * The current player's per-game settings (e.g. Gaia Project's toggles). 401/404 when
 * logged out, not a player, or the game has no settings — callers should `.catch(() => null)`.
 */
export function loadGameSettings(gameId: string): Promise<Record<string, unknown>> {
	return get(`/gameplay/${gameId}/settings`);
}
