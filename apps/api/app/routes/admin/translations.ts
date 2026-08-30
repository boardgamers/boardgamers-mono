import { randomUUID } from "node:crypto";
import { canUser, canUserManageGame, locales, pageGameSlug } from "@bgs/models";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { metadataNeedsTranslation, metadataSourceHash, metadataSourceStrings } from "../../models/gameinfo-i18n.ts";
import { actionRateLimit } from "../../services/actionratelimit.ts";
import { translateMarkdown } from "../../services/translate.ts";
import { type BulkTranslateJob, listBulkJobs, startBulkJob, writeBulkJob } from "./bulkjob.ts";

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

	// Game metadata: per game × locale base subtag, the translations overlay's
	// status and which fields it covers. Status mirrors the pages matrix, with
	// one extra state: "missing" (no overlay), "outdated" (the current source
	// text hashes differently than the overlay's translatedFrom.hash stamp),
	// "ok" (stamped and fresh), and "unknown" (overlay predates translatedFrom
	// tracking — no stamp, so freshness can't be told either way). Content
	// hash, NOT doc.updatedAt: the doc's updatedAt bumps on every write (likes,
	// status recomputes, the overlay write itself), so a timestamp comparison
	// would self-invalidate — see metadataSourceHash. The tracked unit is the
	// whole overlay: per-field outdatedness would need per-field hashes; the
	// pragmatic unit is the source text as a whole.
	const metaLangs = metadataTargetLangs();
	const visibleGames = canUser(ctx.state.user, "pages")
		? metadatas
		: metadatas.filter((m) => canUserManageGame(ctx.state.user, m._id));
	const gameRows = visibleGames.map((meta) => {
		const sourceHash = metadataSourceHash(metadataSourceStrings(meta));
		const cells = Object.fromEntries(
			metaLangs.map((lang) => {
				const overlay = meta.translations?.[lang];
				if (!overlay) {
					return [lang, { status: "missing", fields: [] }];
				}
				// Non-text overlay keys (translatedFrom) are not translated fields.
				const fields = (["description", "rules", "credits"] as const).filter((f) => !!overlay[f]);
				// `?.hash` is defensive: schema-invalid stamps (validation is "warn")
				// degrade to "unknown" instead of a crash or a false "ok".
				const stampedHash = overlay.translatedFrom?.hash;
				if (!stampedHash) {
					return [lang, { status: "unknown", fields }];
				}
				return [lang, { status: stampedHash === sourceHash ? "ok" : "outdated", fields }];
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

// -- Bulk metadata translation (#306 follow-up) -------------------------------

// The languages metadata translates into: base subtags of every supported UI
// locale except English (the source). Same target set as the per-game
// translate-all route and the metadata grid's columns.
function metadataTargetLangs(): string[] {
	return [...new Set(locales.map((l) => l.split("-")[0]))].filter((l) => l !== "en");
}

// The source strings/hash/predicate helpers are shared with the per-game
// translate routes and the overview above: models/gameinfo-i18n.ts
// (metadataSourceStrings, metadataSourceHash, metadataNeedsTranslation — a
// pair needs translation when its overlay is missing or outdated; stamp-less
// "unknown" overlays only under the includeUnknown opt-in).

// Defensive cap on (game, language) pairs per bulk run — every pair is up to
// three paid LLM completions. Sized so a full-language refresh of the catalog
// fits in one run.
const BULK_METADATA_MAX_PAIRS = 200;

const metadataBulkSchema = z.object({
	// Refresh one language across all games; omitted = every language below.
	targetLang: z
		.string()
		.trim()
		.regex(/^[a-z]{2,3}$/, "targetLang must be a base language subtag (2–3 lowercase letters)")
		.optional(),
	// Also re-translate legacy stamp-less ("unknown") overlays. Off by default:
	// they're unverifiable but possibly fine, and each is paid LLM work — see
	// metadataNeedsTranslation.
	includeUnknown: z.boolean().optional().default(false),
});

// POST /translate-metadata-bulk — kick off a bulk metadata translation run:
// {targetLang} for "every game whose metadata overlay in that language is
// missing or outdated", {} for every such (game, language) pair. Job-based
// like the pages'
// translate-bulk (202 + job id, same settings-doc shape, same dashboard jobs
// table) — a run is many games × 3 paid LLM completions, way past a request's
// budget. Site "pages" admins only: the run spans every game, so per-game
// (gameinfo:<slug>) grants don't gate it (unlike the per-game translate-all).
router.post("/translate-metadata-bulk", actionRateLimit("admin/translate-metadata-bulk"), async (ctx) => {
	if (!canUser(ctx.state.user, "pages")) {
		throw createError(403, "Missing admin permission: pages");
	}
	const { targetLang, includeUnknown } = metadataBulkSchema.parse(ctx.request.body ?? {});

	const metadatas = await colls.gameMetadatas
		.find(
			{},
			{
				projection: {
					_id: 1,
					label: 1,
					description: 1,
					rules: 1,
					credits: 1,
					translations: 1,
				},
			},
		)
		.sort({ _id: 1 })
		.toArray();

	// Count only pairs that will actually be translated (source text present,
	// overlay missing or outdated — plus unknown under the opt-in) so the
	// progress total isn't inflated — the job loop re-checks each pair with the
	// same predicate as a safety net against concurrent edits.
	const targetLangs = targetLang ? [targetLang] : metadataTargetLangs();
	const pairs = metadatas.flatMap((doc) =>
		targetLangs
			.filter((lang) => metadataNeedsTranslation(doc, lang, { includeUnknown }))
			.map((lang) => ({ item: doc._id, lang })),
	);
	if (pairs.length > BULK_METADATA_MAX_PAIRS) {
		throw createError(400, `Too many (game, language) pairs: ${pairs.length} > ${BULK_METADATA_MAX_PAIRS}`);
	}

	const job: BulkTranslateJob = {
		status: "running",
		kind: "metadata",
		total: pairs.length,
		done: 0,
		translated: 0,
		skipped: 0,
		errors: [],
	};
	const jobId = randomUUID();
	await writeBulkJob(jobId, job);
	startBulkJob(jobId, job, pairs, async ({ item: game, lang }) => {
		const doc = await colls.gameMetadatas.findOne(
			{ _id: game },
			{ projection: { label: 1, description: 1, rules: 1, credits: 1, translations: 1 } },
		);
		// In-loop re-check, same predicate (and includeUnknown mode) as job
		// creation: an overlay can have been written or the source edited
		// (per-game translate-all, another bulk run) in between — a pair that
		// became fresh skip-counts instead of being re-paid.
		if (!doc || !metadataNeedsTranslation(doc, lang, { includeUnknown })) {
			return "skipped";
		}
		const source = metadataSourceStrings(doc);
		const overlay = Object.fromEntries(
			await Promise.all(
				Object.entries(source).map(async ([field, text]) => [
					field,
					await translateMarkdown({
						text,
						sourceLang: "en",
						targetLang: lang,
						context: `${field} of the boardgame "${doc.label ?? game}"`,
					}),
				]),
			),
		);
		// Same $set overlay path — and the same translatedFrom.hash stamp — as
		// the per-game translate routes, so bulk-translated overlays get
		// outdated-tracking too.
		await colls.gameMetadatas.updateOne(
			{ _id: game },
			{ $set: { [`translations.${lang}`]: { ...overlay, translatedFrom: { hash: metadataSourceHash(source) } } } },
		);
		return "translated";
	});

	ctx.status = 202;
	ctx.body = { jobId, total: job.total };
});

export default router;
