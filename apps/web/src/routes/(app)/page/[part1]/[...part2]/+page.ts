import type { PageLoad } from "./$types";
import { get, toKitError } from "@/lib/api";
import { stripMarkdown, truncate } from "@/lib/seo";

export const load: PageLoad = async ({ params }) => {
	const parts = [params.part1, params.part2].filter(Boolean);
	// An unknown content page 404s at the api — surface that as a 404 page, not a 500.
	const pageContent = await get<{ title: string; content?: string }>(`/page/${parts.join(":")}`).catch(toKitError);
	return {
		pageContent,
		seo: {
			title: pageContent.title,
			description: truncate(stripMarkdown(`${pageContent.content ?? ""}`), 200),
			type: "article",
		},
	};
};
