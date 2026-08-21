import { browser } from "$app/environment";
import type { LayoutLoad } from "./$types";
import {
	seedAccountFromSSR,
	seedActiveGamesFromSSR,
	seedLikedBoardgamesFromSSR,
	sidebarOpen,
} from "@/lib/stores.svelte";
import { fetchGameInfos, gameInfoKey } from "@/lib/game-info.svelte";
import type { GameInfoFront } from "@bgs/models";
import type { SetOptional } from "type-fest";
import { initWebsocket } from "@/lib/websocket.svelte";
import { get, setClientSessionKnown } from "@/lib/api";
import { initNProgress } from "@/lib/nprogress.svelte";
import { initErrorReporting } from "@/lib/report-error.svelte";
import { initTimezoneCookie } from "@/lib/timezone";
import { initLanguage } from "@/lib/i18n/messages";
import { setLanguageCookie } from "@/lib/i18n/language";
import "@/lib/theme";

export const load: LayoutLoad = async ({ data }) => {
	// Seed the mint gate from cookie presence *synchronously, before any await*: page
	// loads (e.g. /game/<id>'s /gameplay/* fetches) run concurrently with this layout
	// load, and their mint decision must not see a stale/unseeded flag on a cold load.
	// Refined to the validated user below (seedAccountFromSSR) — a present-but-invalid
	// cookie flips it back to false there.
	if (browser) {
		setClientSessionKnown(data?.hasCookie);
	}

	// Sidebar open is a non-sensitive UI preference — safe to set during SSR.
	if (data?.sidebarOpen !== undefined) {
		sidebarOpen.set(data.sidebarOpen);
	}

	// Stamp the browser's timezone into the `tz` cookie BEFORE any await, so it's
	// set even if a later fetch throws — the next SSR render then uses it (#339).
	// The timezone itself is provided to the tree by +layout.svelte (setContext
	// is component-only); `data.timezone` below carries it to the client, where
	// it equals the browser zone this cookie was just stamped from.
	initTimezoneCookie();

	// Seed the client's UI language from the SSR-resolved value (#306) BEFORE any
	// await, so hydration renders the same language as the server HTML. When the
	// layout resolved a user-preference override, the cookie (read by hooks) may
	// lag behind — re-stamp it so the next SSR paint agrees, and fix <html lang>
	// (transformed with the hooks value when they differed).
	if (browser && data?.language) {
		await initLanguage(data.language);
		setLanguageCookie(data.language);
		document.documentElement.lang = data.language;
	}

	// Public game-info list, fetched fresh per request (SSR-safe: returned, not stored).
	// The root layout component seeds the reactive store from this on the browser, so
	// SSR always renders current game data (no shared 1-hour server cache).
	const gameInfos: Record<string, SetOptional<GameInfoFront, "viewer">> = await fetchGameInfos().catch(() => ({}));
	// `likeCount` is shared across a game's versions and `liked` targets the game, not a
	// version — but only the latest version's info is kept current, so older-version entries
	// can carry a stale count (or none). Seed them from the `/latest` entry so every version
	// of a game shows the same like state (and the count is SSR'd).
	for (const [key, info] of Object.entries(gameInfos)) {
		if (!key.endsWith("/latest")) {
			const latest = gameInfos[gameInfoKey(info._id.game, "latest")];
			if (latest) {
				info.likeCount = latest.likeCount;
				info.liked = latest.liked;
			}
		}
	}

	// Boardgames the player has played or liked — the sidebar's "My games" group. Rows
	// carry `lastPlayedAt` (play recency) and `likedAt` (like recency) so the sidebar
	// derives the blended "freshest first" ordering. SSR-safe (request-scoped fetch via
	// getRequestEvent), so the group renders on first paint, not after hydration.
	type MyBoardgameRow = { boardgame: string; lastPlayedAt?: string; liked?: boolean; likedAt?: string };
	let myBoardgames: MyBoardgameRow[] = [];
	if (data?.user?._id) {
		myBoardgames = await get<MyBoardgameRow[]>("/game/my-boardgames", {
			user: data.user._id,
		}).catch(() => []);
	}

	if (browser) {
		// Seed the client stores from the SSR snapshot. These are no-ops on a
		// same-identity revalidation (see the "seed once per identity" invariant in
		// stores.svelte.ts), so `invalidateAll()` re-runs don't clobber live state,
		// while login/logout (identity change) re-seed from the fresh snapshot.
		const user = data?.user ?? null;
		seedAccountFromSSR(user);
		seedActiveGamesFromSSR(data?.activeGames ?? [], user?._id ?? null);
		seedLikedBoardgamesFromSSR(
			Object.fromEntries(myBoardgames.flatMap((r) => (r.likedAt ? [[r.boardgame, Date.parse(r.likedAt)]] : []))),
			user?._id ?? null,
		);

		initWebsocket();
		initNProgress();
		initErrorReporting();
	}

	// Pass through the layout data so child pages can access it via `await parent()`
	return {
		user: data?.user ?? null,
		activeGames: data?.activeGames ?? [],
		myBoardgames,
		gameInfos,
		timezone: data?.timezone ?? "UTC",
		language: data?.language ?? "en",
	};
};
