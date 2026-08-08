import type { RequestHandler } from "./$types";
import { get } from "@/lib/api";
import type { GameInfoFront, PageFront } from "@bgs/models";
import type { SetOptional } from "type-fest";

// Sitemaps are crawl hints: lastmod comes from the data (gameinfo/page updatedAt), and
// changefreq/priority reflect how the content actually evolves.
type SitemapEntry = {
	path: string;
	lastmod?: string;
	changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly";
	priority?: number;
};

const staticEntries: SitemapEntry[] = [
	{ path: "/", changefreq: "hourly", priority: 1 },
	{ path: "/boardgames", changefreq: "weekly", priority: 0.9 },
	{ path: "/games", changefreq: "hourly", priority: 0.8 },
	{ path: "/new-game", changefreq: "weekly", priority: 0.7 },
	{ path: "/login", changefreq: "monthly", priority: 0.3 },
	{ path: "/signup", changefreq: "monthly", priority: 0.5 },
];

function xmlEscape(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function entryXml(origin: string, entry: SitemapEntry): string {
	let xml = `  <url>\n    <loc>${xmlEscape(origin + entry.path)}</loc>\n`;
	if (entry.lastmod) {
		xml += `    <lastmod>${entry.lastmod}</lastmod>\n`;
	}
	if (entry.changefreq) {
		xml += `    <changefreq>${entry.changefreq}</changefreq>\n`;
	}
	if (entry.priority !== undefined) {
		xml += `    <priority>${entry.priority.toFixed(1)}</priority>\n`;
	}
	return xml + "  </url>\n";
}

export const GET: RequestHandler = async ({ url }) => {
	// Same public data as the catalog page, fetched through the request-scoped API client.
	const gameInfos = await get<SetOptional<GameInfoFront, "viewer">[]>("/boardgame/info").catch(() => []);

	const entries: SitemapEntry[] = [...staticEntries];

	// Latest public version of each boardgame.
	const boardgames = new Map<string, SetOptional<GameInfoFront, "viewer">>();
	for (const info of gameInfos) {
		if (!info.meta?.public) {
			continue;
		}
		const existing = boardgames.get(info._id.game);
		if (!existing || existing._id.version < info._id.version) {
			boardgames.set(info._id.game, info);
		}
	}

	for (const info of boardgames.values()) {
		const lastmod = info.updatedAt?.slice(0, 10);
		entries.push({ path: `/boardgame/${info._id.game}`, lastmod, changefreq: "daily", priority: 0.8 });
		entries.push({ path: `/boardgame/${info._id.game}/games`, changefreq: "hourly", priority: 0.6 });
		entries.push({ path: `/boardgame/${info._id.game}/rankings`, changefreq: "daily", priority: 0.6 });
	}

	// Content pages live in the database; the listing endpoint omits their markdown body.
	const pages = await get<Pick<PageFront, "_id" | "updatedAt">[]>("/page").catch(() => []);
	for (const contentPage of pages) {
		entries.push({
			path: `/page/${contentPage._id.name}`,
			lastmod: contentPage.updatedAt?.slice(0, 10),
			changefreq: "monthly",
			priority: 0.5,
		});
	}

	const body =
		`<?xml version="1.0" encoding="UTF-8"?>\n` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
		entries.map((entry) => entryXml(url.origin, entry)).join("") +
		`</urlset>\n`;

	return new Response(body, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
};
