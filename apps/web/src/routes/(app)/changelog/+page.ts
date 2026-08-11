import type { PageLoad } from "./$types";
import { get } from "@/lib/api";
import type { ChangelogFront } from "@bgs/models";

export const ENTRIES_PER_PAGE = 10;

export const load: PageLoad = async ({ url }) => {
	const pageNumber = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
	const before = url.searchParams.get("before") ?? undefined;

	const entries = await get<ChangelogFront[]>("/site/changelog", {
		limit: ENTRIES_PER_PAGE + 1,
		...(before ? { before } : {}),
	});

	return {
		pageNumber,
		entries: entries.slice(0, ENTRIES_PER_PAGE),
		hasMore: entries.length > ENTRIES_PER_PAGE,
		seo: {
			title: "Changelog — Boardgamers",
			description: "Recent changes, new features and fixes on Boardgamers.",
			type: "article",
		},
	};
};
