import { canUser, canUserManageGame, locales, pageGameSlug } from "@bgs/models";
import type { Context } from "koa";
import Router from "koa-router";
import { colls } from "../../config/db.ts";
import { listBulkJobs } from "./pages.ts";

const router = new Router<Application.DefaultState, Context>();

// Same access rule as the pages router: blanket "pages" admins see every
// page; a per-boardgame admin sees their games' pages (and games).
function canManagePage(user: Context["state"]["user"], pageName: string): boolean {
	if (canUser(user, "pages")) {
		return true;
	}
	const slug = pageGameSlug(pageName);
	return slug !== null && canUserManageGame(user, slug);
}

// GET /overview — the translations dashboard's single aggregate read (#306):
// the pages × locales status matrix, the game-metadata × locale presence
// grid, and every bulk-translate job. Read-only.
router.get("/overview", async (ctx) => {
	const [pages, metadatas, jobs] = await Promise.all([
		colls.pages.find({}, { projection: { _id: 1, title: 1, updatedAt: 1, translatedFrom: 1 } }).toArray(),
		colls.gameMetadatas
			.find({}, { projection: { _id: 1, label: 1, alias: 1, description: 1, rules: 1, credits: 1, translations: 1 } })
			.sort({ _id: 1 })
			.toArray(),
		listBulkJobs(),
	]);

	// Pages matrix: one row per page name, one cell per supported locale.
	// A cell is "ok" when the translation exists, "outdated" when the source
	// it was translated from has been updated since, "missing" otherwise.
	const visiblePages = canUser(ctx.state.user, "pages")
		? pages
		: pages.filter((p) => canManagePage(ctx.state.user, p._id.name));
	const byKey = new Map(visiblePages.map((p) => [`${p._id.name}/${p._id.lang}`, p]));
	const names = [...new Set(visiblePages.map((p) => p._id.name))].sort();
	const pageRows = names.map((name) => {
		const title = visiblePages.find((p) => p._id.name === name && p._id.lang === "en")?.title ?? name;
		const cells = Object.fromEntries(
			locales.map((lang) => {
				const page = byKey.get(`${name}/${lang}`);
				if (!page) {
					return [lang, { status: "missing" }];
				}
				const source = page.translatedFrom && byKey.get(`${name}/${page.translatedFrom.lang}`);
				const outdated = !!(
					page.translatedFrom &&
					source?.updatedAt &&
					source.updatedAt > page.translatedFrom.updatedAt
				);
				return [lang, { status: outdated ? "outdated" : "ok" }];
			}),
		);
		return { name, title, cells };
	});

	// Game metadata: per game × locale base subtag, whether a translations
	// overlay exists and which fields it covers. There is no translatedFrom
	// tracking here — presence is all the data there is.
	const metaLangs = [...new Set(locales.map((l) => l.split("-")[0]))].filter((l) => l !== "en");
	const visibleGames = canUser(ctx.state.user, "pages")
		? metadatas
		: metadatas.filter((m) => canUserManageGame(ctx.state.user, m._id));
	const gameRows = visibleGames.map((meta) => {
		const cells = Object.fromEntries(
			metaLangs.map((lang) => {
				const overlay = meta.translations?.[lang];
				return [lang, { translated: !!overlay, fields: overlay ? Object.keys(overlay) : [] }];
			}),
		);
		return {
			game: meta._id,
			label: meta.label,
			alias: meta.alias,
			sourceFields: (["description", "rules", "credits"] as const).filter((f) => !!meta[f]),
			cells,
		};
	});

	ctx.body = {
		locales,
		metaLangs,
		pages: pageRows,
		games: gameRows,
		jobs: jobs.map(({ jobId, job }) => ({ jobId, ...job })),
	};
});

export default router;
