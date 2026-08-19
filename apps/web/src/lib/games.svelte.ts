import type { GameStatus, GameFront } from "@bgs/models";
import { SvelteMap } from "svelte/reactivity";
import { get } from "./api";
import { LIVE_GAME_MAX_TIME_PER_GAME, type GamePace } from "@/utils";

export type LoadGamesParams = {
	boardgameId?: string;
	userId?: string | null;
	sample?: boolean;
	skip?: number;
	count?: number;
	minDuration?: number;
	maxDuration?: number;
	/** Live/async timing filter — maps to a min/max on timePerGame. Overrides min/maxDuration. */
	pace?: GamePace;
	gameStatus: GameStatus;
	fetchCount?: boolean;
	store?: boolean;
	/** Bypass the cache read AND overwrite the entry — user-triggered refresh (logo click, sidebar active-game, avatar save). */
	refresh?: boolean;
	search?: string;
	/** The viewer's karma, from the SSR `page.data.user` snapshot — NOT the client-only
	 *  account store. Threading it through the params (and thus the cache key) keeps the
	 *  server prefetch and the client read identical, fixing the #345 double-fetch. */
	viewerKarma?: number;
};

export type LoadGamesResult = {
	games: GameFront[];
	total: number;
};

/**
 * The chosen setup-option values of an open-games filter: option name → required
 * value (`true` for checkbox options, the item name for select options).
 */
export type SetupOptionFilter = Record<string, string | true>;

/**
 * Client-side setup-options match (#55): a game passes when every filtered option
 * is set to the wanted value in the game's own `game.options`. Checkbox options
 * store `true` when on (absent when off), select options the chosen item name.
 */
export function matchesSetupOptions(game: GameFront, filter: SetupOptionFilter | undefined): boolean {
	if (!filter) {
		return true;
	}
	const options = (game.game.options ?? {}) as Record<string, unknown>;
	return Object.entries(filter).every(([name, value]) => options[name] === value);
}

const gamesCache = new SvelteMap<string, LoadGamesResult>();

export type GameListConfig = {
	gameStatus: GameStatus;
	boardgameId?: string;
	userId?: string | null;
	sample?: boolean;
	topRecords?: boolean;
	perPage?: number;
	page?: number;
	pace?: GamePace;
	search?: string;
	/** Client-side setup-options filter (option name → required value). Widens the fetch. */
	optionFilter?: SetupOptionFilter;
	/** The viewer's karma (SSR snapshot) — see LoadGamesParams.viewerKarma. */
	viewerKarma?: number;
};

/** Maps a GameList's list config to loadGames params. Used by BOTH GameList's load
 * and the +page.ts prefetches that seed the cache — the cache key derives from these
 * params, so a single builder is what keeps the two from drifting apart (a drift is
 * invisible client-side but breaks SSR: the component's synchronous cache read misses
 * and the list renders empty in the HTML — see #332's fetchCount regression). */
export function gameListParams({
	gameStatus,
	boardgameId,
	userId,
	sample = false,
	topRecords = false,
	perPage = 10,
	page = 0,
	pace,
	search,
	optionFilter,
	viewerKarma,
}: GameListConfig): LoadGamesParams {
	return {
		gameStatus,
		boardgameId,
		userId,
		sample,
		pace,
		// With a setup-options filter the narrowing happens client-side, so fetch
		// beyond one page of candidates (the API caps at 100) to have rows to filter.
		count: optionFilter ? 100 : perPage,
		skip: optionFilter ? 0 : page * perPage,
		// Sample lists also fetch the count: it's what powers the "N more open games"
		// discovery affordance (the sample itself is capped at perPage).
		fetchCount: !topRecords,
		search,
		viewerKarma,
	};
}

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
	pace,
	sample,
	userId,
	boardgameId,
	gameStatus,
	fetchCount = !sample,
	store = false,
	refresh = false,
	search,
	viewerKarma,
}: LoadGamesParams) {
	// The pace filter maps to a timePerGame bound: live games have a sub-day clock,
	// async games a day-or-more clock.
	if (pace === "live") {
		maxDuration = LIVE_GAME_MAX_TIME_PER_GAME - 1;
		minDuration = undefined;
	} else if (pace === "async") {
		minDuration = LIVE_GAME_MAX_TIME_PER_GAME;
		maxDuration = undefined;
	}

	const queryParams = {
		count,
		skip,
		...(sample && { sample: true }),
		...(userId && { user: userId }),
		...(boardgameId && { boardgame: boardgameId }),
		// maxKarma comes from the SSR `page.data.user` snapshot (threaded as viewerKarma),
		// not the client-only account store — so server prefetch and client read build the
		// same query + cache key (#345: no double-fetch / post-hydration list swap).
		...(gameStatus === "open" && viewerKarma !== undefined && { maxKarma: viewerKarma }),
		...(minDuration && { minDuration }),
		...(maxDuration && { maxDuration }),
		...(search && { search }),
	};

	const key = JSON.stringify({ ...queryParams, gameStatus, fetchCount });

	if (!store && !refresh && gamesCache.has(key)) {
		return gamesCache.get(key)!;
	}

	return Promise.all([
		get<GameFront[]>(`/game/status/${gameStatus}`, queryParams),
		fetchCount ? get<number>(`/game/status/${gameStatus}/count`, queryParams) : 0,
	]).then(async ([games, total]) => {
		if (store || refresh) {
			gamesCache.set(key, { games, total });
		}

		return { games, total };
	});
}
