import { get } from "./api";
import type { GamePreferencesFront, UserFront } from "@bgs/models";

export type UserCardData = {
	user: UserFront;
	elo: GamePreferencesFront[];
};

type CacheEntry = {
	promise: Promise<UserCardData | null>;
	data?: UserCardData | null;
};

// Per-username cache for hover-card contents — a username maps to the same profile for the
// whole session, so one fetch per user no matter how many times their name is hovered.
const cache = new Map<string, CacheEntry>();

export function getUserCardData(username: string): CacheEntry {
	const key = username.toLowerCase();
	let entry = cache.get(key);
	if (entry) {
		return entry;
	}

	const promise = (async () => {
		const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(username)}`);
		const elo = user?._id
			? await get<GamePreferencesFront[]>(`/user/${user._id}/games/elo`).catch(() => [] as GamePreferencesFront[])
			: [];
		return { user, elo };
	})().catch(() => null);

	entry = { promise };
	cache.set(key, entry);
	promise.then((data) => {
		entry.data = data;
	});
	return entry;
}
