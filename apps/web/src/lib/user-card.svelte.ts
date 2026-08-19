import { SvelteMap } from "svelte/reactivity";
import { get } from "./api";
import type { GamePreferencesFront, UserFront } from "@bgs/models";

// A boardgame the user liked, as returned by /user/:userId/liked-games (most-liked first).
type LikedGame = { game: string; label: string; alias?: string; likeCount: number };

export type UserCardData = {
	user: UserFront;
	elo: GamePreferencesFront[];
	/** The user's liked games (most-liked first) — the hovercard shows a compact meeple count. */
	likedGames: LikedGame[];
};

type CacheEntry = {
	promise: Promise<UserCardData | null>;
	data?: UserCardData | null;
};

// Per-username cache for hover-card contents — a username maps to the same profile for the
// whole session, so one fetch per user no matter how many times their name is hovered.
const cache = new SvelteMap<string, CacheEntry>();

export function getUserCardData(username: string): CacheEntry {
	const key = username.toLowerCase();
	let entry = cache.get(key);
	if (entry) {
		return entry;
	}

	const promise = (async () => {
		const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(username)}`);
		const [elo, likedGames] = user?._id
			? await Promise.all([
					get<GamePreferencesFront[]>(`/user/${user._id}/games/elo`).catch(() => [] as GamePreferencesFront[]),
					get<LikedGame[]>(`/user/${user._id}/liked-games`).catch(() => [] as LikedGame[]),
				])
			: [[], []];
		return { user, elo, likedGames };
	})().catch(() => null);

	entry = { promise };
	cache.set(key, entry);
	promise.then((data) => {
		entry.data = data;
	});
	return entry;
}
