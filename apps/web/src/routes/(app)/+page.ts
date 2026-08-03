import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import { loadGames, clearGamesCache } from "@/lib/games.svelte";

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
		announcement: await get<{ title: string; content: string }>("/site/announcement"),
	};
};
