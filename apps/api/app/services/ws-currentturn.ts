import type { ObjectId } from "mongodb";
import { findGamesWithPlayersTurn } from "../models/index.ts";

export type CurrentTurnSocket = {
	user?: ObjectId | null;
	send: (data: string) => unknown;
};

// Key of the game-id list last pushed on this socket (`WeakMap` so sockets can be GC'd).
const lastCurrentTurnKey = new WeakMap<CurrentTurnSocket, string>();

/**
 * Push `games:currentTurn` only when the ids differ from what was last pushed on this
 * socket. Returns `true` when a message was sent.
 */
export function sendCurrentTurnIds(ws: CurrentTurnSocket, gameIds: string[]): boolean {
	const key = gameIds.toSorted().join("\n");
	if (lastCurrentTurnKey.get(ws) === key) {
		return false;
	}
	lastCurrentTurnKey.set(ws, key);
	ws.send(JSON.stringify({ command: "games:currentTurn", games: gameIds }));
	return true;
}

/**
 * Re-check which games await the socket user's move and push the id list when it changed.
 * The DB query runs every call — it's the authoritative change check — but the send is
 * skipped while the set is stable, so steady-state sockets (the common case) don't
 * receive (and clients don't re-render on) an identical list every ping.
 */
export async function sendActiveGames(ws: CurrentTurnSocket): Promise<void> {
	if (!ws.user) {
		return;
	}
	const gamesList = await findGamesWithPlayersTurn(ws.user).project({ _id: 1 }).toArray();
	sendCurrentTurnIds(
		ws,
		gamesList.map((game) => game._id),
	);
}
