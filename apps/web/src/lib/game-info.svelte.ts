import { browser } from "$app/environment";
import { getContext, hasContext, setContext } from "svelte";
import type { GameInfoFront } from "@bgs/models";
import { sortBy, uniqBy } from "lodash";
import { get as getStore } from "svelte/store";
import type { SetOptional } from "type-fest";
import { clientWritable } from "./stores.svelte";
import { get } from "./api";

/**
 * The game-info LIST (no `viewer` — the list endpoint omits it) is provided via Svelte
 * context, set by the root layout component from its `data.gameInfos` (fetched fresh per
 * request). Context is available during SSR and on the client, so this is the single read
 * path for list consumers (sidebar, boardgames, new-game, elo, avatars…). The full doc
 * WITH `viewer` is separate — only the game player needs it, and it gets it from
 * `game/[gameId]`'s own context (`page.data.gameInfo`), not here.
 */
const GAME_INFOS_KEY = "gameInfos";

export type GameInfoMap = Record<string, SetOptional<GameInfoFront, "viewer">>;

/**
 * Browser-only shared store — the backing cache for `gameInfo()` (the non-component
 * fallback), `getGameInfo`, `mergeGameInfos`, `loadGameInfo(s)`. NOT exported: component
 * list reads must go through the context (`useGameInfos`/`useGameInfo`/`useLatestGameInfos`).
 * `clientWritable` throws on mutation during SSR, so this can never leak across requests.
 */
const gameInfos = clientWritable<GameInfoMap>("gameInfos", {});

/** Called once by the root layout component with the SSR-fetched list. */
export function provideGameInfos(map: GameInfoMap): void {
	setContext(GAME_INFOS_KEY, map);
}

/**
 * Read the game-info list from context. Must be called during component init (getContext).
 * Falls back to `{}` outside a provider (defensive — the root layout always provides it).
 */
export function useGameInfos(): GameInfoMap {
	return hasContext(GAME_INFOS_KEY) ? getContext<GameInfoMap>(GAME_INFOS_KEY) : {};
}

export function gameInfoKey(name: string, version: number | "latest"): string {
	return `${name}/${version}`;
}

/**
 * Non-context fallback for non-component callers (load functions, lib helpers). Reads the
 * shared store — which is browser-seeded only, so this is client-side; SSR list reads must
 * go through `useGameInfos()` in a component.
 */
export function gameInfo(name: string, version: number | "latest" = "latest") {
	return getStore(gameInfos)[gameInfoKey(name, version)];
}

/** Convenience for components: resolve one game's info from the provided list context. */
export function useGameInfo(name: string, version: number | "latest" = "latest") {
	return useGameInfos()[gameInfoKey(name, version)];
}

/** Convenience for components: the latest-version info of every game from the list context. */
export function useLatestGameInfos(): SetOptional<GameInfoFront, "viewer">[] {
	const map = useGameInfos();
	return Object.keys(map)
		.filter((key) => key.endsWith("/latest"))
		.map((key) => map[key]);
}

/**
 * Build the keyed store map from the raw list — writing both `name/version` for every
 * version and `name/latest` for each game's highest version, preserving any already-loaded
 * `viewer` (the list endpoint omits it). Pure: returns a new object, touches nothing.
 */
function buildGameInfoMap(games: Array<Omit<GameInfoFront, "viewer">>) {
	const map: Record<string, SetOptional<GameInfoFront, "viewer">> = {};
	const latestGames = new Set(uniqBy(sortBy(games, "_id.version").reverse(), "_id.game"));

	for (const game of games) {
		const id = gameInfoKey(game._id.game, game._id.version);
		const viewer = getStore(gameInfos)[id]?.viewer;
		map[id] = { viewer, ...game };
		if (latestGames.has(game)) {
			map[gameInfoKey(game._id.game, "latest")] = { viewer, ...game };
		}
	}
	return map;
}

/**
 * Fetch the public game-info list, WITHOUT touching the store. SSR-safe: `get` uses the
 * request's `event.fetch` and the result is returned, so the root layout can SSR the list
 * fresh per request (no 1-hour server cache) with no shared-state mutation.
 */
export async function fetchGameInfos(): Promise<Record<string, SetOptional<GameInfoFront, "viewer">>> {
	const games = await get<Array<Omit<GameInfoFront, "viewer">>>("/boardgame/info");
	return buildGameInfoMap(games);
}

/** Browser-only: replace the reactive store with a fetched map. Never during SSR (shared state). */
export function seedGameInfos(map: Record<string, SetOptional<GameInfoFront, "viewer">>) {
	if (!browser) {
		throw new Error("seedGameInfos must not run during SSR — shared store");
	}
	gameInfos.set(map);
}

let promise: Promise<void> | null = null;
/** Browser-only: fetch + seed the store (deduped concurrent calls). Prefer `fetchGameInfos` in loads. */
export async function loadGameInfos(): Promise<void> {
	if (!browser) {
		throw new Error("loadGameInfos must not run during SSR — use fetchGameInfos and return the data");
	}
	if (promise) {
		return promise;
	}
	return (promise = fetchGameInfos().then(
		(map) => {
			promise = null;
			seedGameInfos(map);
		},
		(err) => {
			promise = null;
			return Promise.reject(err);
		},
	));
}

/**
 * Fetch the full game-info doc (including `viewer`), WITHOUT touching the store. SSR-safe:
 * the doc is returned, so a `load` can SSR it with no shared-state mutation. A nonexistent
 * boardgame resolves to undefined (handled "not found", not a server error).
 */
export async function fetchGameInfo(
	game: string,
	version: number | "latest" = "latest",
): Promise<GameInfoFront | undefined> {
	return get<GameInfoFront>(`/boardgame/${game}/info/${version}`).catch((err) => {
		if (err?.status === 404) {
			return undefined;
		}
		throw err;
	});
}

/**
 * Get the full game-info doc (with `viewer`), using the store as a client-side cache.
 * In the browser: return the cached doc if present (no network call); on a miss, fetch AND
 * store it so subsequent reads hit the cache and reactive consumers update. On the server
 * (SSR): fetch and return only — never write the shared store.
 */
export async function getGameInfo(
	game: string,
	version: number | "latest" = "latest",
): Promise<GameInfoFront | undefined> {
	if (browser) {
		const cached = getStore(gameInfos)[gameInfoKey(game, version)];
		if (cached?.viewer) {
			return cached as GameInfoFront;
		}
		const info = await fetchGameInfo(game, version);
		if (info) {
			mergeGameInfos([info]);
		}
		return info;
	}
	return fetchGameInfo(game, version);
}

/** Browser-only: merge full game-info docs into the reactive store. Never during SSR (shared state). */
export function mergeGameInfos(infos: Array<GameInfoFront | undefined>) {
	if (!browser) {
		throw new Error("mergeGameInfos must not run during SSR — shared store");
	}
	gameInfos.update((all) => {
		const next = { ...all };
		for (const info of infos) {
			if (!info?._id) {
				continue;
			}
			next[gameInfoKey(info._id.game, info._id.version)] = info;
		}
		return next;
	});
}

const loading = new Map<string, Promise<void>>();
/**
 * Browser-only: fetch the full doc (with `viewer`) and merge it into the store. Skips the
 * network call if the store already has the full doc (viewer present) — e.g. when the
 * current game's info was loaded alongside the all-games list. Deduped concurrent calls.
 */
export async function loadGameInfo(game: string, version: number | "latest" = "latest"): Promise<void> {
	if (!browser) {
		throw new Error("loadGameInfo must not run during SSR — use fetchGameInfo and return the data");
	}
	const id = gameInfoKey(game, version);
	if (loading.has(id)) {
		return loading.get(id);
	}
	if (getStore(gameInfos)[id]?.viewer) {
		return;
	}

	loading.set(
		id,
		fetchGameInfo(game, version).then(
			(info) => {
				loading.delete(id);
				if (info) {
					mergeGameInfos([info]);
				}
			},
			(err) => {
				loading.delete(id);
				return Promise.reject(err);
			},
		),
	);

	return loading.get(id);
}
