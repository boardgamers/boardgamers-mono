import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import { stripMarkdown, truncate } from "@/lib/seo";

export const load: PageLoad = async ({ params }) => {
	const parts = [params.part1, params.part2].filter(Boolean);
	const pageContent = await get<{ title: string; content?: string }>(`/page/${parts.join(":")}`);
	return {
		pageContent,
		seo: {
			title: pageContent.title,
			description: truncate(stripMarkdown(`${pageContent.content ?? ""}`), 200),
			type: "article",
		},
	};
};
