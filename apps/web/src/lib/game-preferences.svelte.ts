import { browser } from "$app/environment";
import { getContext, hasContext, setContext } from "svelte";
import type { GameInfoFront, GamePreferencesFront } from "@bgs/models";
import { isEmpty } from "lodash";
import { get as getStore } from "svelte/store";
import type { Primitive } from "type-fest";
import { account, clientWritable } from "./stores.svelte";
import { get, post } from "./api";

export const gamePreferences = clientWritable<Record<string, GamePreferencesFront>>("gamePreferences", {});

/**
 * Preferences are per-user and reactive (updated via `updatePreference`), so the store is
 * the client read API. But the store is browser-only — empty during SSR. Layouts that SSR
 * preferences (boardgame, boardgames, new-game, game) provide their SSR-fetched prefs via
 * context, so readers can fall back to it server-side. `useGamePreference()` reads the
 * store first (reactive on the client), then the context fallback (SSR).
 */
const GAME_PREFS_KEY = "gamePreferences";

/** Called by a layout component with the prefs its load SSR-fetched. */
export function provideGamePreferences(prefs: Record<string, GamePreferencesFront>): void {
	setContext(GAME_PREFS_KEY, prefs);
}

/**
 * Capture the layout-provided SSR preferences for this component (component-init only,
 * getContext). Use with the store in a `$derived`: `$gamePreferences[game] ?? ssrPrefs[game]`
 * — reactive on the client (store), correct during SSR (context fallback).
 */
export function useGamePreferencesFallback(): Record<string, GamePreferencesFront> {
	return hasContext(GAME_PREFS_KEY) ? getContext<Record<string, GamePreferencesFront>>(GAME_PREFS_KEY) : {};
}

export function addDefaults(prefs: GamePreferencesFront, gameinfo: GameInfoFront) {
	if (!gameinfo?.preferences || !prefs?.preferences) {
		return prefs;
	}

	return {
		...prefs,
		preferences: {
			...Object.fromEntries(
				gameinfo.preferences.filter((item) => item.default != null).map((item) => [item.name, item.default]),
			),
			...prefs.preferences,
		},
	};
}

export async function updatePreference(gameName: string, version: number, key: string, value: Primitive) {
	gamePreferences.update((gamePreferences) => {
		// Immutable update: replace the per-game object (and its `preferences`) rather than
		// mutating it in place with lodash `set`. Downstream `$derived` chains (StartedGame's
		// `storedPrefs` → `prefs` → the postPreferences $effect) compare by reference - an
		// in-place mutation kept the same per-game reference, so a sidebar toggle never
		// re-posted the preferences into the running game iframe (only a page refresh did).
		const game = gamePreferences[gameName];
		const updated = {
			...game,
			preferences: { ...game?.preferences, [key]: value },
		} as typeof game;
		return {
			...gamePreferences,
			[gameName]: updated,
		};
	});

	if (getStore(account)) {
		await post(`/account/games/${gameName}/preferences/${version}`, getStore(gamePreferences)[gameName].preferences);
	}
}

const augment = (data: GamePreferencesFront) => {
	if (!data.access) {
		data.access = { ownership: false };
	}
	if (!data.preferences) {
		data.preferences = {};
	}

	return data;
};

/**
 * Fetch one game's preferences for the current session, WITHOUT touching the store.
 * SSR-safe: `get` uses the request's `event.fetch` (cookie-forwarded, request-scoped),
 * and the result is returned — so a `load` function can SSR per-user prefs with no
 * shared-state leak. Logged-out requests get the default-shape object.
 */
export async function fetchGamePreferences(game: string): Promise<GamePreferencesFront> {
	// Logged out → 401; return the default-shape object (same as the previous behavior).
	const data = await get<GamePreferencesFront>(`/account/games/${game}/settings`).catch((err) => {
		if (err?.status === 401 || err?.status === 404) {
			return { game } as GamePreferencesFront;
		}
		throw err;
	});
	return augment(data);
}

/** Fetch all games' preferences for the current session, WITHOUT touching the store. SSR-safe. */
export async function fetchAllGamePreferences(): Promise<Record<string, GamePreferencesFront>> {
	const prefs = await get<GamePreferencesFront[]>("/account/games/settings").catch((err) => {
		if (err?.status === 401 || err?.status === 404) {
			return [] as GamePreferencesFront[];
		}
		throw err;
	});
	const data: Record<string, GamePreferencesFront> = {};
	for (const pref of prefs) {
		data[pref.game] = augment(pref);
	}
	return data;
}

/**
 * Get one game's preferences, using the store as a client-side cache: in the browser, if
 * the store already has this game's prefs, return it with no network call; otherwise (SSR
 * or a cache miss) fetch it. SSR-safe: the result is returned, never written to the store.
 */
export async function getGamePreferences(game: string): Promise<GamePreferencesFront> {
	if (browser) {
		const cached = getStore(gamePreferences)[game];
		if (cached) {
			return cached;
		}
		const prefs = await fetchGamePreferences(game);
		mergeGamePreferences({ [game]: prefs });
		return prefs;
	}
	return fetchGamePreferences(game);
}

/** Browser-only: merge preferences into the reactive store cache. Never call during SSR (shared module state). */
export function mergeGamePreferences(prefs: Record<string, GamePreferencesFront>) {
	if (!browser) {
		throw new Error("mergeGamePreferences must not run during SSR — per-user store");
	}
	gamePreferences.update((all) => ({ ...all, ...prefs }));
}

/**
 * Store-cached getter for the WHOLE prefs map (mirrors `getGamePreferences`). In the
 * browser: return the cached store if non-empty (no refetch); on a miss fetch and populate
 * the store. On SSR: fetch and return (no store write). The returned map can be provided
 * via context (`provideGamePreferences`) for SSR rendering.
 */
export async function getAllGamePreferences(): Promise<Record<string, GamePreferencesFront>> {
	if (browser) {
		const cached = getStore(gamePreferences);
		if (!isEmpty(cached)) {
			return cached;
		}
		const data = await fetchAllGamePreferences();
		gamePreferences.set(data);
		return data;
	}
	return fetchAllGamePreferences();
}

if (browser) {
	let prevAccountId = getStore(account)?._id;
	account.subscribe((accountVal) => {
		if (prevAccountId === accountVal?._id) {
			return;
		}

		prevAccountId = accountVal?._id;
		gamePreferences.set({});
	});
}
