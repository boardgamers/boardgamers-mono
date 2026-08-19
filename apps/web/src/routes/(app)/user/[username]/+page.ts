import type { PageLoad } from "./$types";
import { get, toKitError } from "@/lib/api";
import { loadGames, clearGamesCache, gameListParams } from "@/lib/games.svelte";
import { shareImageUrl } from "@/lib/seo";
import { dateFromObjectId } from "@/utils/time";
import type { GamePreferencesFront, UserFront } from "@bgs/models";

export const load: PageLoad = async ({ params, parent }) => {
	clearGamesCache();
	// `user` here is the *profile* being viewed. The root layout's `user` is the *viewer*
	// (the logged-in account) — name it distinctly so ownership is computed server-side
	// and the edit-profile button renders in SSR HTML (no post-hydration flash).
	// get() throws an ApiError on any api status >= 400 — convert it so an unknown user
	// renders the 404 page (and other api failures keep their status) instead of a 500.
	const [{ user: viewer }, user] = await Promise.all([
		parent(),
		get<UserFront>(`/user/infoByName/${encodeURIComponent(params.username)}`).catch(toKitError),
	]);

	const [, , , elo] = await Promise.all([
		loadGames({ ...gameListParams({ userId: user._id, gameStatus: "active", perPage: 5 }), store: true }),
		// viewerKarma (the SSR viewer's karma) keeps server prefetch + client read on the
		// same cache key (#345) — the viewer is the requester for the karma filter.
		loadGames({
			...gameListParams({ userId: user._id, gameStatus: "open", perPage: 5, viewerKarma: viewer?.account?.karma }),
			store: true,
		}),
		loadGames({ ...gameListParams({ userId: user._id, gameStatus: "ended", perPage: 5 }), store: true }),
		// Public per-user elo ratings — SSR'd here so UserElo renders synchronously.
		get<GamePreferencesFront[]>(`/user/${user._id}/games/elo`).catch(() => []),
	]);

	const username = params.username;
	const joinDate = dateFromObjectId(user._id!);
	const joined = `${joinDate.toLocaleString("en", { month: "long" })} ${joinDate.toLocaleString("en", { year: "numeric" })}`;

	return {
		user,
		elo,
		isOwnProfile: viewer?._id === user._id,
		seo: {
			title: `${username}'s profile`,
			description: user.account.bio || `${username} joined in ${joined} and has ${user.account.karma} karma.`,
			image: shareImageUrl({ kind: "user", id: username }),
			type: "profile",
		},
	};
};
