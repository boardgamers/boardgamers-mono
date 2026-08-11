import { api } from "$lib/api.ts";
import type { GameFront, ApiErrorFront } from "@bgs/models";

type GameCounts = Record<string, number>;
type RecentGame = Pick<GameFront, "_id" | "game" | "status" | "lastMove" | "createdAt">;

export interface GamesPageData {
	// Named gameCounts (not games) — `games` is the layout's GameInfoFront[] and would be shadowed in page.data.
	gameCounts: GameCounts;
	recentGames: RecentGame[];
	hangsTotal: number;
}

// serverinfo carries the status counts + recent games; hangs are EngineTimeoutError
// apiErrors (same source as /game/hangs, count-only here).
export async function load(): Promise<GamesPageData> {
	const [serverInfo, hangs] = await Promise.all([
		api.get<{ games: GameCounts; recentGames: RecentGame[] }>("/admin/serverinfo").catch(() => null),
		api
			.get<{ errors: ApiErrorFront[]; total: number }>("/admin/errors?name=EngineTimeoutError&limit=1")
			.catch(() => ({ errors: [], total: 0 })),
	]);

	return {
		gameCounts: serverInfo?.games ?? {},
		recentGames: serverInfo?.recentGames ?? [],
		hangsTotal: hangs.total,
	};
}
