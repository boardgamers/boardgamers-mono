import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import { loadGames, clearGamesCache, gameListParams } from "@/lib/games.svelte";
import { shareImageUrl } from "@/lib/seo";

export const load: PageLoad = async ({ parent }) => {
	clearGamesCache();
	const { user, activeGames } = await parent();
	// The viewer's karma, from the SSR user snapshot — threaded into the open-games
	// query so server prefetch and client read build the same cache key (#345).
	const viewerKarma = user?.account?.karma;

	// gameListParams mirrors the GameLists in +page.svelte exactly ("My games" /
	// "Featured games" / Lobby) — the cache key must match the component's request
	// for the SSR render to find the seeded entry.
	const firstGames = loadGames({
		...gameListParams(
			activeGames.length > 0
				? { gameStatus: "active", userId: user?._id ?? null, perPage: 5 }
				: { gameStatus: "active", topRecords: true, perPage: 5 },
		),
		store: true,
	});
	const secondGames = loadGames({
		...gameListParams({ gameStatus: "open", sample: true, perPage: 5, viewerKarma }),
		store: true,
	});

	await Promise.all([firstGames, secondGames]);

	return {
		announcement: await get<{ content: string }>("/site/announcement"),
		seo: {
			title: "Boardgamers — play boardgames online",
			description:
				"Play Gaia Project, Powergrid, 6nimmt and Container online with other people, live or asynchronously. All games and the platform are open source!",
			image: shareImageUrl({ kind: "home" }),
		},
	};
};
