import { error } from "@sveltejs/kit";
import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import type { GamePreferencesFront, UserFront } from "@bgs/models";

export const load: PageLoad = async ({ params, parent }) => {
	clearGamesCache();
	const user = await get<UserFront>(`/user/infoByName/${encodeURIComponent(params.username)}`);

	if (!user) {
		throw error(404, "User not found");
	}

	// The root layout's `user` is the *viewer* (this page's own `user` below is the profile
	// being viewed, which overrides it in `page.data`). Compare against the viewer to decide
	// ownership server-side so the "Edit profile" button is present in the SSR HTML.
	const { user: viewer } = await parent();
	const isOwnProfile = viewer?._id === user._id;

	const [, , , elo] = await Promise.all([
		loadGames({ userId: user._id, gameStatus: "active", count: 5, store: true }),
		loadGames({ userId: user._id, gameStatus: "open", count: 5, store: true }),
		loadGames({ userId: user._id, gameStatus: "ended", count: 5, store: true }),
		// Public per-user elo ratings — SSR'd here so UserElo renders synchronously.
		get<GamePreferencesFront[]>(`/user/${user._id}/games/elo`).catch(() => []),
	]);

	return { user, elo, isOwnProfile };
};
