import { browser } from "$app/environment";
import { getContext, hasContext, setContext } from "svelte";
import type { GameInfoFront } from "@bgs/models";
import { sortBy, uniqBy } from "lodash";
import { get as getStore } from "svelte/store";
import type { SetOptional } from "type-fest";
import { clientWritable } from "./stores.svelte";
import { get } from "./api";
import { gameDisplayName } from "@/utils/game-label";

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
 * The provided map is a `$state` proxy (created in the root layout component), so reads
 * inside `$derived`/`$effect`/markup track it and re-run when a like toggles. `useGameInfos`
 * returns it by reference — callers must NOT capture `map[key]` at init outside a reactive
 * context, or they freeze the value.
 */
export type GameInfoState = GameInfoMap;

/**
 * Browser-only shared store — the backing cache for `gameInfo()` (the non-component
 * fallback), `getGameInfo`, `mergeGameInfos`. NOT exported: component
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

/**
 * Reactive list accessor: returns the context map so reads inside `$derived`/`$effect`
 * track it. Unlike `useGameInfos` (same reference), the name documents the intent that
 * the result is read reactively, not captured once.
 */
export function gameInfosState(): GameInfoMap {
	return useGameInfos();
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

/**
 * Convenience for components: the latest-version info of every game from the list context.
 * NOTE: reads the map once at call time. Call it inside a `$derived`/`$effect` (or another
 * reactive context) if the result must track like/unlike updates — a bare `const x =
 * useLatestGameInfos()` at component init freezes the snapshot.
 */
export function useLatestGameInfos(): SetOptional<GameInfoFront, "viewer">[] {
	const map = useGameInfos();
	return Object.keys(map)
		.filter((key) => key.endsWith("/latest"))
		.map((key) => map[key]);
}

/**
 * Discovery ordering (#98): games the current user liked first, then most-liked,
 * display name (alias-aware) breaking ties. Comparator — callers sort a COPY
 * (`list.slice().sort(byGamePopularity)`), never the shared store array.
 */
export function byGamePopularity(
	a: Pick<GameInfoFront, "label" | "alias"> & Partial<Pick<GameInfoFront, "liked" | "likeCount">>,
	b: Pick<GameInfoFront, "label" | "alias"> & Partial<Pick<GameInfoFront, "liked" | "likeCount">>,
): number {
	return (
		Number(b.liked ?? false) - Number(a.liked ?? false) ||
		(b.likeCount ?? 0) - (a.likeCount ?? 0) ||
		gameDisplayName(a).localeCompare(gameDisplayName(b))
	);
}

/**
 * "My games" ordering (sidebar): "freshest first" — each game's sort key is the MOST
 * RECENT of its last-played time and its like time, descending. A game played today
 * but liked a year ago sorts by its play time; a game liked an hour ago but last
 * played a month ago sorts by the like; a liked-never-played game sorts by `likedAt`.
 * Pure: `lastPlayedAtMs` / `likedAtMs` map game → timestamp (ms); a missing key means
 * "no such signal" (treated as 0, so a game with neither sinks to the bottom).
 */
export function byMyGamesOrder(
	lastPlayedAtMs: Readonly<Record<string, number>>,
	likedAtMs: Readonly<Record<string, number>>,
): (a: GameInfoFront, b: GameInfoFront) => number {
	const freshness = (id: string) => Math.max(lastPlayedAtMs[id] ?? 0, likedAtMs[id] ?? 0);
	return (a, b) =>
		freshness(b._id.game) - freshness(a._id.game) || gameDisplayName(a).localeCompare(gameDisplayName(b));
}

/**
 * Apply a client-side like/unlike to every entry for the game (all versions + `latest`).
 * `likeCount` is shared across versions, so the map entries must move together — otherwise
 * the sidebar/catalog (reading `/latest`) and the button disagree. Pure.
 */
export function applyGameLike<T extends SetOptional<GameInfoFront, "viewer">>(
	map: Record<string, T>,
	game: string,
	like: { liked: boolean; likeCount: number },
): Record<string, T> {
	const prefix = `${game}/`;
	const next = { ...map };
	for (const key of Object.keys(next)) {
		if (key.startsWith(prefix)) {
			next[key] = { ...next[key], liked: like.liked, likeCount: like.likeCount };
		}
	}
	return next;
}

/**
 * Re-seed the per-user like state (`liked` + `likeCount`) onto an existing game-info map
 * after a login/logout. `liked` is per-user (the /boardgame/info join), so when the user
 * identity changes the fresh list's like state is the new truth — applied onto the existing
 * entries (preserving any already-loaded `viewer`), adding any new keys. Pure: returns a new
 * object. The caller is responsible for only invoking this on an identity CHANGE, not a
 * same-identity revalidation (which would clobber a client-side like-toggle — #293).
 */
export function reseedGameInfoLikes<T extends SetOptional<GameInfoFront, "viewer">>(
	map: Record<string, T>,
	fresh: Record<string, T>,
): Record<string, T> {
	const next = { ...map };
	for (const [key, info] of Object.entries(fresh)) {
		next[key] = key in next ? { ...next[key], liked: info.liked, likeCount: info.likeCount } : info;
	}
	return next;
}

/**
 * Build the keyed store map from the raw list — writing both `name/version` for every
 * version and `name/latest` for each game's highest version, preserving any already-loaded
 * `viewer` (the list endpoint omits it). Pure: returns a new object, touches nothing.
 */
export function buildGameInfoMap(games: Array<Omit<GameInfoFront, "viewer">>) {
	const map: Record<string, SetOptional<GameInfoFront, "viewer">> = {};
	// Function-local transient (identity membership check within this call), never read
	// reactively — SvelteSet would buy nothing here.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
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

/** Browser-only: patch the legacy store's like fields for one game (all versions). */
export function patchGameInfosLike(game: string, like: { liked: boolean; likeCount: number }) {
	if (!browser) {
		throw new Error("patchGameInfosLike must not run during SSR — shared store");
	}
	gameInfos.update((all) => applyGameLike(all, game, like));
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
