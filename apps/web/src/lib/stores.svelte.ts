import { browser } from "$app/environment";
import type { ChatMessageFront, UserFront } from "@bgs/models";
import { SvelteDate } from "svelte/reactivity";
import { writable, type Writable } from "svelte/store";
import { setClientSessionKnown } from "./api";

/**
 * Per-user/session stores are client-only: they live in module scope, so on the server
 * they're shared across concurrent SSR requests and writing them would leak one request's
 * state into another's render. `clientWritable` wraps a store so ANY mutation (set/update,
 * direct or via a helper) throws during SSR — failing loudly in dev instead of leaking.
 * Reads/subscribes are harmless, so only mutation is guarded.
 */
export function clientWritable<T>(name: string, initial: T): Writable<T> {
	const { subscribe, set, update } = writable<T>(initial);
	const guard = () => {
		if (!browser) {
			throw new Error(`"${name}" is a client-only store and must not be mutated during SSR.`);
		}
	};
	return {
		subscribe,
		set: (v: T) => {
			guard();
			set(v);
		},
		update: (fn: (v: T) => T) => {
			guard();
			update(fn);
		},
	};
}

export function assertBrowserStore(name: string) {
	if (!browser) {
		throw new Error(`"${name}" is a per-user client store and must not be mutated during SSR.`);
	}
}

/**
 * Read an SSR-seeded, client-live store in a component `$derived`.
 *
 * Returns the store value on the client (the single source of truth once seeded), and
 * the SSR snapshot during server render / the very first hydration pass — so SSR HTML
 * is correct with no flash and there is no hydration mismatch. After hydration the
 * seeded store takes over and live-updates.
 *
 * Usage: `let user = $derived(live($account, data.user));`
 *
 * This replaces the buggy `$store ?? data.x` / `store.length > 0 ? $store : data.x`
 * patterns: it never conflates "empty" with "not yet loaded", because on the client it
 * always trusts the seeded store (even when empty), and during SSR it always trusts the
 * snapshot.
 */
export function live<T>(storeValue: T, ssrSnapshot: T): T {
	return browser ? storeValue : ssrSnapshot;
}

// --- SSR-seeded, client-live stores -------------------------------------------------
//
// INVARIANT (the "seed once per identity" contract):
//   These stores hold per-session client state. They are browser-only: during SSR the
//   store stays at its initial value (never mutated — that would leak one request's
//   state into another's render) and components render the SSR `data` snapshot instead.
//   On the client the store is seeded from that snapshot exactly once per *identity*,
//   then it becomes the single source of truth — live-updated by websocket pushes and
//   user actions. Re-running loads (e.g. `invalidateAll()` after login/logout) produces
//   a fresh snapshot with a *different identity*, which re-seeds; a same-identity
//   snapshot (a plain revalidation) must NOT clobber live store state.
//
// Components therefore read `$store` directly on the client and `data.x` during SSR,
// never `$store ?? data.x` — after the seed an empty store is a *real* empty state
// (e.g. zero active games), not "not yet loaded".

// --- Account (client-side cache, seeded from the layout's SSR `user`) ---

export const account = clientWritable<UserFront | null>("account", null);

// The last SSR snapshot identity the account store was seeded from (its user id, or
// `null` for an anonymous snapshot). Compared against incoming snapshots so a
// revalidation for the same user doesn't reset locally-mutated account state.
let accountSeededFor: string | null | undefined;

/**
 * Directly write the account (login, confirm, settings saves, …). Also advances the
 * seed guard: the guard's job is to ignore *stale* snapshots, not fresh
 * same-identity ones. `setAuthData`'s `invalidateAll()` and a subsequent navigation
 * race two layout loads, and when the older snapshot's load resolves last it
 * re-seeds the store with pre-write state (the email-confirm stale-UI bug: the
 * store ended up holding `confirmed=false` from a snapshot captured before the
 * confirm committed). Stamping the guard on every direct write keeps such a
 * late-arriving stale snapshot a no-op, while a genuinely fresh snapshot (same id,
 * loaded after the write) still re-seeds.
 */
export function setAccount(user: UserFront | null) {
	accountSeededFor = user?._id ?? null;
	account.set(user);
}

/**
 * Seed the account store from the layout's SSR snapshot. Runs on the client only.
 * No-op once a snapshot for this identity (`user._id`, or `null` when logged out) has
 * already seeded the store — so `invalidateAll()` re-runs don't clobber live state,
 * while a genuine login/logout (identity change) re-seeds with the fresh snapshot.
 */
export function seedAccountFromSSR(user: UserFront | null) {
	if (!browser) return;
	// Keep api.ts's session flag in sync so anonymous clients never attempt the
	// cookie-authed /account/mint (the httpOnly cookie is invisible to JS).
	setClientSessionKnown(!!user);
	const id = user?._id ?? null;
	if (accountSeededFor === id) return;
	accountSeededFor = id;
	account.set(user);
}

// --- Active games (loaded via +layout.server.ts, maintained by websocket) ---

export const activeGames = clientWritable<string[]>("activeGames", []);

// The exact array reference we last wrote into `activeGames` from an SSR snapshot, and
// the identity (user id / `null`) that snapshot belonged to. We re-apply a snapshot
// only when the store still holds that reference — meaning no websocket push
// (`activeGames.set`) has replaced it since. Once the store has been live-updated it is
// authoritative and a same-identity revalidation must not clobber it (the #167 bug
// class: an empty push is a real empty state, not "not yet loaded").
let activeGamesLastSeeded: string[] | undefined;
let activeGamesSeededFor: string | null | undefined;

/**
 * Seed the activeGames store from the layout's SSR snapshot. Client-only.
 *
 * - On an identity change (login/logout → `forUserId` differs), always apply: the fresh
 *   snapshot is the new user's truth and the websocket will re-push live state anyway.
 * - On a same-identity revalidation (`invalidateAll`), apply only when the store has not
 *   been live-updated since the last seed; otherwise the websocket-fed store is truth.
 */
export function seedActiveGamesFromSSR(games: string[], forUserId: string | null) {
	if (!browser) return;
	let current: string[] | undefined;
	activeGames.subscribe((v) => (current = v))();
	const identityChanged = activeGamesSeededFor !== forUserId;
	const storeUntouched = activeGamesLastSeeded === undefined || current === activeGamesLastSeeded;
	if (!identityChanged && !storeUntouched) return;
	activeGamesSeededFor = forUserId;
	activeGamesLastSeeded = games;
	activeGames.set(games);
}

export function addActiveGame(gameId: string) {
	let current = false;
	activeGames.subscribe((games) => {
		current = games.includes(gameId);
	})();
	if (!current) {
		activeGames.update((games) => [...games, gameId]);
	}
}

export function removeActiveGame(gameId: string) {
	activeGames.update((games) => games.filter((g) => g !== gameId));
}

// --- Liked boardgames (sidebar "My games" freshest-first ordering) ---

/**
 * Per-user like timestamps, `game → likedAt` (ms since epoch). One of the two
 * freshness signals the sidebar blends into its "freshest first" ordering
 * (max(lastPlayedAt, likedAt)). Seeds the ordering on first paint and live-tracks
 * toggles: liking stamps `now` (refreshing the game's position in "My games"),
 * unliking deletes the entry. The store is the client-side truth once seeded (same
 * "seed once per identity" contract as `account` above); SSR renders the
 * `myBoardgames` rows' `likedAt` snapshot instead.
 */
export const likedBoardgames = clientWritable<Record<string, number>>("likedBoardgames", {});

let likedBoardgamesSeededFor: string | null | undefined;

/** Seed from the layout's SSR snapshot. Client-only; no-op on same-identity revalidation. */
export function seedLikedBoardgamesFromSSR(likes: Record<string, number>, forUserId: string | null) {
	if (!browser) return;
	if (likedBoardgamesSeededFor === forUserId) return;
	likedBoardgamesSeededFor = forUserId;
	likedBoardgames.set(likes);
}

/** Live-apply a like toggle: stamp `now` on like, drop the entry on unlike. Client-only. */
export function applyLikedBoardgame(game: string, liked: boolean) {
	if (!browser) return;
	likedBoardgames.update((likes) => {
		const next = { ...likes };
		if (liked) {
			next[game] = Date.now();
		} else {
			delete next[game];
		}
		return next;
	});
}

// --- Current game (websocket-maintained, shared across game components) ---

export const currentGameId = clientWritable<string | null>("currentGameId", null);
export const lastGameUpdate = clientWritable<Date>("lastGameUpdate", new SvelteDate(0));
export const playerStatus = clientWritable<Array<{ _id: string; status: "online" | "offline" | "away" }>>(
	"playerStatus",
	[],
);

if (browser) {
	currentGameId.subscribe(() => {
		lastGameUpdate.set(new Date(0));
		playerStatus.set([]);
	});
}

// --- Current room / chat (websocket-maintained) ---

export const room = clientWritable<string | null>("room", null);
export const chatMessages = clientWritable<ChatMessageFront[]>("chatMessages", []);

if (browser) {
	currentGameId.subscribe((val) => room.set(val));
	room.subscribe(() => chatMessages.set([]));
}

// --- Sidebar open (UI state, cookie-backed) ---

import { extractCookie } from "@/utils/extract-cookie";

export const sidebarOpen = writable<boolean>(
	browser ? (extractCookie("sidebarOpen", document.cookie) ?? false) : false,
);

if (browser) {
	sidebarOpen.subscribe((val) => {
		document.cookie = `sidebarOpen=${JSON.stringify(val)}; Path=/; Max-Age=${365 * 10 * 24 * 3600}; SameSite=Lax; Secure`;
	});
}

// --- Logo clicks, developer settings (minor UI state) ---

export const logoClicks = writable<number>(0);
export function logoClick(): void {
	logoClicks.update((n) => n + 1);
}

// Bumped when the user changes their avatar (style switch or upload) so every
// <UserAvatar> that passes it as `v` gets a new `?v=` URL and refetches —
// the api URL is otherwise stable. Read via `$avatarVersion`; bump via
// `bumpAvatarVersion()`. (ETag + no-cache on the api already revalidates for
// avatars that don't pass `v`; this is for instant feedback on the change.)
export const avatarVersion = writable<number>(0);
export function bumpAvatarVersion(): void {
	avatarVersion.update((n) => n + 1);
}

export type DevGameSettings = {
	viewerUrl: string;
};

export const developerSettings = writable<boolean>(
	browser && JSON.parse(localStorage.getItem("developerSettings") ?? "false"),
);

export const devGameSettings = writable<Record<string, DevGameSettings>>(
	browser ? JSON.parse(localStorage.getItem("devGameSettings") ?? "{}") : {},
);

if (browser) {
	devGameSettings.subscribe((val) => localStorage.setItem("devGameSettings", JSON.stringify(val)));

	developerSettings.subscribe((newVal) => {
		if (newVal) {
			localStorage.setItem("developerSettings", JSON.stringify(newVal));
		} else {
			localStorage.removeItem("developerSettings");
		}
	});
}
