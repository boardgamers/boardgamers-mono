import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import type { GamePreferencesFront, UserFront } from "@bgs/models";

export const load: PageLoad = async ({ params }) => {
	clearGamesCache();
	const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(params.username)}`);

	if (!user) {
		throw error(404, "User not found");
	}

	const [, , , elo] = await Promise.all([
		loadGames({ userId: user._id, gameStatus: "active", count: 5, store: true }),
		loadGames({ userId: user._id, gameStatus: "open", count: 5, store: true }),
		loadGames({ userId: user._id, gameStatus: "ended", count: 5, store: true }),
		// Public per-user elo ratings — SSR'd here so UserElo renders synchronously.
		get<GamePreferencesFront[]>(`/user/${user._id}/games/elo`).catch(() => []),
	]);

	return { user, elo };
};
