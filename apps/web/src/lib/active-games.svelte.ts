import { get as getStore } from "svelte/store";
import { activeGames } from "./stores.svelte";

/**
 * Apply a `games:currentTurn` push. The server already skips unchanged lists; guard here
 * too (stale server, out-of-band sends) so an identical id list doesn't trigger a no-op
 * re-render / downstream refetch via the store.
 */
export function handleCurrentTurnGames(gameIds: string[]): void {
	const current = getStore(activeGames);
	if (gameIds.length === current.length && gameIds.every((id, i) => id === current[i])) {
		return;
	}
	activeGames.set(gameIds);
}
