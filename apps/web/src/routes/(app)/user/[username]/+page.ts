import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import type { GamePreferencesFront, UserFront } from "@bgs/models";

export const load: PageLoad = async ({ params, parent }) => {
	clearGamesCache();
	// `user` here is the *profile* being viewed. The root layout's `user` is the *viewer*
	// (the logged-in account) — name it distinctly so ownership is computed server-side
	// and the edit-profile button renders in SSR HTML (no post-hydration flash).
	const [{ user: viewer }, user] = await Promise.all([
		parent(),
		get<UserFront>(`/user/infoByName/${encodeURIComponent(params.username)}`),
	]);

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

	return { user, elo, isOwnProfile: viewer?._id === user._id };
};
