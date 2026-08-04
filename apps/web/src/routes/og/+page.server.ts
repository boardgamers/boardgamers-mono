import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
	const title = url.searchParams.get("title")?.slice(0, 90) || "Boardgamers";
	const subtitle = url.searchParams.get("subtitle")?.slice(0, 140) || "";

	return { title, subtitle };
};
