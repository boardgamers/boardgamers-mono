import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";
import { shareImageUrl } from "@/lib/seo";

export const load: PageLoad = async ({ parent }) => {
	clearGamesCache();
	const { user, activeGames } = await parent();

	const firstGames = loadGames({
		gameStatus: "active",
		count: 5,
		store: true,
		...(activeGames.length > 0 ? { userId: user?._id ?? null } : { fetchCount: false }),
	});
	const secondGames = loadGames({ sample: true, gameStatus: "open", count: 5, store: true });

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
