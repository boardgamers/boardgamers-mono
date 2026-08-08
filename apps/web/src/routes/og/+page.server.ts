import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
	const title = url.searchParams.get("title")?.slice(0, 90) || "Boardgamers";
	const subtitle = url.searchParams.get("subtitle")?.slice(0, 140) || "";
	const game = url.searchParams.get("game")?.slice(0, 60) || "";
	const players = url.searchParams.get("players")?.slice(0, 40) || "";
	const pace = url.searchParams.get("pace")?.slice(0, 40) || "";

	return { title, subtitle, game, players, pace };
};
