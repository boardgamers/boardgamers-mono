import type { GameStatus, GameFront } from "@bgs/models";
import { SvelteMap } from "svelte/reactivity";
import { get as getStore } from "svelte/store";
import { account } from "./stores.svelte";
import { get } from "./api";

export type LoadGamesParams = {
	boardgameId?: string;
	userId?: string | null;
	sample?: boolean;
	skip?: number;
	count?: number;
	minDuration?: number;
	maxDuration?: number;
	gameStatus: GameStatus;
	fetchCount?: boolean;
	store?: boolean;
	search?: string;
};

export type LoadGamesResult = {
	games: GameFront[];
	total: number;
};

const gamesCache = new SvelteMap<string, LoadGamesResult>();

/** Clear cached game results. Called from +page.ts load functions to prevent
 *  stale data from a previous navigation being served on the new page. */
export function clearGamesCache() {
	gamesCache.clear();
}

export function loadGames({
	count = 10,
	skip = 0,
	minDuration,
	maxDuration,
	sample,
	userId,
	boardgameId,
	gameStatus,
	fetchCount = !sample,
	store = false,
	search,
}: LoadGamesParams) {
	const queryParams = {
		count,
		skip,
		...(sample && { sample: true }),
		...(userId && { user: userId }),
		...(boardgameId && { boardgame: boardgameId }),
		...(gameStatus === "open" && !!getStore(account)?._id && { maxKarma: getStore(account)!.account.karma }),
		...(minDuration && { minDuration }),
		...(maxDuration && { maxDuration }),
		...(search && { search }),
	};

	const key = JSON.stringify({ ...queryParams, gameStatus, fetchCount });

	if (!store && gamesCache.has(key)) {
		return gamesCache.get(key)!;
	}

	return Promise.all([
		get<GameFront[]>(`/game/status/${gameStatus}`, queryParams),
		fetchCount ? get<number>(`/game/status/${gameStatus}/count`, queryParams) : 0,
	]).then(async ([games, total]) => {
		if (store) {
			gamesCache.set(key, { games, total });
		}

		return { games, total };
	});
}
