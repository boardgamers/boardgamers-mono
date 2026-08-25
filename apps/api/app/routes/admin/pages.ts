import { randomUUID } from "node:crypto";
import {
	MAX_PAGE_HISTORY_VERSIONS,
	canUser,
	canUserManageGame,
	locales,
	pageGameSlug,
	type PageDoc,
} from "@bgs/models";
import { omit } from "@bgs/utils/object";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { actionRateLimit } from "../../services/actionratelimit.ts";
import { TranslationError, translateMarkdown } from "../../services/translate.ts";

const router = new Router<Application.DefaultState, Context>();

// Per-boardgame admins (gameinfo:<slug>) manage their game's CMS pages — the
// `<slug>:<topic>` pages — while the blanket "pages" permission manages ALL
// pages (game pages included). The /page mount gate lets both through; every
// route then calls requirePageAccess against the page's slug.
function canManagePage(user: Context["state"]["user"], pageName: string): boolean {
	if (canUser(user, "pages")) {
		return true;
	}
	const slug = pageGameSlug(pageName);
	return slug !== null && canUserManageGame(user, slug);
}

function requirePageAccess(ctx: Context, pageName: string) {
	if (!canManagePage(ctx.state.user, pageName)) {
		const slug = pageGameSlug(pageName);
		throw createError(
			403,
			slug ? `Missing admin permission: gameinfo:${slug} or pages` : "Missing admin permission: pages",
		);
	}
}

// Archive the page's current state before it is overwritten/deleted, then trim
// the page's history to the most recent MAX_PAGE_HISTORY_VERSIONS entries.
async function recordPageHistory(page: PageDoc, editedBy: ObjectId) {
	await colls.pageHistories.insertOne({
		page: page._id,
		title: page.title,
		content: page.content,
		editedBy,
		createdAt: new Date(),
	});
	const stale = await colls.pageHistories
		.find({ page: page._id }, { projection: { _id: 1 } })
		.sort({ createdAt: -1, _id: -1 })
		.skip(MAX_PAGE_HISTORY_VERSIONS)
		.toArray();
	if (stale.length > 0) {
		await colls.pageHistories.deleteMany({ _id: { $in: stale.map((entry) => entry._id) } });
	}
}

// BCP-47-ish language tag: a 2–3 letter base subtag, optionally one
// region/script segment ("de", "pt-BR"). Canonicalized to lowercase base +
// uppercase region, matching the locale codes' conventional casing.
const langTag = z
	.string()
	.trim()
	.regex(/^[a-z]{2,3}(-[a-z0-9]+)?$/i, 'must be a language tag like "de" or "pt-BR"')
	.transform((tag) =>
		tag
			.split("-")
			.map((part, i) => (i === 0 ? part.toLowerCase() : part.toUpperCase()))
			.join("-"),
	);

// Defensive cap on (page, language) pairs per bulk run — every pair is two
// paid LLM completions.
const BULK_TRANSLATE_MAX_PAIRS = 50;

interface BulkTranslateJob {
	status: "running" | "done";
	total: number;
	done: number;
	translated: number;
	skipped: number;
	errors: { page: string; lang: string; message: string }[];
}

// In-memory on purpose: admin-only, a handful of runs per hour, and the api
// serves /api/admin from a single process (PM2 forks are for cron, which
// mounts no routes). A lost job (process reload) just means re-clicking.
// Finished jobs are evicted after an hour so the map can't grow unbounded.
const bulkTranslateJobs = new Map<string, BulkTranslateJob>();

function evictJob(jobId: string) {
	setTimeout(() => bulkTranslateJobs.delete(jobId), 3600_000).unref();
}

const bulkTranslateSchema = z
	.object({
		// Refresh one language across all pages…
		targetLang: langTag.optional(),
		// …or translate one page into every supported locale.
		pageName: z.string().trim().min(1).optional(),
		// Version to translate from, when that page exists (else any existing
		// version, then the page is skipped).
		sourceLang: langTag.optional(),
	})
	.refine((v) => (v.targetLang ? !v.pageName : !!v.pageName), {
		message: "Provide exactly one of targetLang or pageName",
	});

function isOutdated(translation: PageDoc, source: PageDoc | undefined): boolean {
	return !!(translation.translatedFrom && source?.updatedAt && source.updatedAt > translation.translatedFrom.updatedAt);
}

async function runBulkTranslateJob(
	job: BulkTranslateJob,
	pairs: { name: string; targetLang: string }[],
	sourceLang: string,
	editedBy: ObjectId,
) {
	for (const { name, targetLang } of pairs) {
		try {
			const versions = await colls.pages.find({ "_id.name": name }).toArray();
			const source =
				versions.find((p) => p._id.lang === sourceLang) ??
				versions.find((p) => p._id.lang === "en") ??
				versions.sort((a, b) => a._id.lang.localeCompare(b._id.lang))[0];
			const existing = versions.find((p) => p._id.lang === targetLang);
			if (!source || source._id.lang === targetLang || (existing && !isOutdated(existing, source))) {
				job.skipped++;
				continue;
			}
			const [title, content] = await Promise.all([
				translateMarkdown({
					text: source.title,
					sourceLang: source._id.lang,
					targetLang,
					context: `title of the "${name}" page`,
				}),
				translateMarkdown({
					text: source.content,
					sourceLang: source._id.lang,
					targetLang,
					context: `content of the "${name}" page`,
				}),
			]);
			await upsertPage(
				{ name, lang: targetLang },
				{ title, content, translatedFrom: { lang: source._id.lang, updatedAt: source.updatedAt ?? new Date() } },
				editedBy,
			);
			job.translated++;
		} catch (err) {
			job.errors.push({ page: name, lang: targetLang, message: err instanceof Error ? err.message : String(err) });
		} finally {
			job.done++;
		}
	}
	job.status = "done";
}

// POST /translate-bulk — kick off a bulk translation run (#306): either
// {targetLang} for "every page missing/outdated in that language" or
// {pageName} for "that page into every supported locale where missing or
// outdated". Returns 202 + a job id; poll GET /translate-bulk/:jobId.
router.post("/translate-bulk", actionRateLimit("admin/translate-bulk"), async (ctx) => {
	const { targetLang, pageName, sourceLang = "en" } = bulkTranslateSchema.parse(ctx.request.body ?? {});

	const pages = await colls.pages.find({}, { projection: { _id: 1 } }).toArray();
	const names = [...new Set(pages.map((p) => p._id.name))].filter((name) => canManagePage(ctx.state.user, name));

	const pairs: { name: string; targetLang: string }[] = [];
	if (targetLang) {
		for (const name of names) {
			pairs.push({ name, targetLang });
		}
	} else {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- the refine guarantees pageName when targetLang is absent
		const name = pageName!;
		if (!canManagePage(ctx.state.user, name)) {
			throw createError(403, "Missing admin permission: pages");
		}
		for (const lang of locales) {
			pairs.push({ name, targetLang: lang });
		}
	}
	if (pairs.length > BULK_TRANSLATE_MAX_PAIRS) {
		throw createError(400, `Too many (page, language) pairs: ${pairs.length} > ${BULK_TRANSLATE_MAX_PAIRS}`);
	}

	const job: BulkTranslateJob = {
		status: "running",
		total: pairs.length,
		done: 0,
		translated: 0,
		skipped: 0,
		errors: [],
	};
	const jobId = randomUUID();
	bulkTranslateJobs.set(jobId, job);
	evictJob(jobId);
	void runBulkTranslateJob(job, pairs, sourceLang, ctx.state.user!._id).catch((err) => {
		job.status = "done";
		job.errors.push({ page: "*", lang: "*", message: err instanceof Error ? err.message : String(err) });
	});

	ctx.status = 202;
	ctx.body = { jobId, total: job.total };
});

router.get("/translate-bulk/:jobId", async (ctx) => {
	const job = bulkTranslateJobs.get(ctx.params.jobId);
	if (!job) {
		throw createError(404, "Job not found");
	}
	ctx.body = job;
});

router.get("/", async (ctx) => {
	// updatedAt + translatedFrom let the admin UI flag outdated translations
	// (#306) without a request per page.
	const pages = await colls.pages.find({}, { projection: { _id: 1, updatedAt: 1, translatedFrom: 1 } }).toArray();
	// Blanket "pages" admins see every page; a scoped (per-boardgame) admin only
	// sees the pages of the games they manage.
	if (canUser(ctx.state.user, "pages")) {
		ctx.body = pages;
		return;
	}
	ctx.body = pages.filter((p) => canManagePage(ctx.state.user, p._id.name));
});

router.get("/:name/:lang", async (ctx) => {
	requirePageAccess(ctx, ctx.params.name);
	const page = await colls.pages.findOne({ _id: { name: ctx.params.name, lang: ctx.params.lang } });
	if (page) {
		ctx.body = page;
	} // else 404
});

// Past versions of the page, newest first, without the (markdown) bodies.
// `editedBy` is resolved to the editor's username for display.
router.get("/:name/:lang/history", async (ctx) => {
	requirePageAccess(ctx, ctx.params.name);
	const entries = await colls.pageHistories
		.find({ page: { name: ctx.params.name, lang: ctx.params.lang } }, { projection: { content: 0 } })
		.sort({ createdAt: -1, _id: -1 })
		.toArray();
	const editors = await colls.users
		.find(
			{ _id: { $in: [...new Set(entries.map((entry) => entry.editedBy))] } },
			{ projection: { "account.username": 1 } },
		)
		.toArray();
	const usernames = new Map(editors.map((user) => [user._id.toHexString(), user.account.username]));
	ctx.body = entries.map((entry) => ({
		...entry,
		editedByUsername: usernames.get(entry.editedBy.toHexString()) ?? null,
	}));
});

router.get("/:name/:lang/history/:id", async (ctx) => {
	requirePageAccess(ctx, ctx.params.name);
	if (!ObjectId.isValid(ctx.params.id)) {
		throw createError(404, "History entry not found");
	}
	const entry = await colls.pageHistories.findOne({
		_id: new ObjectId(ctx.params.id),
		page: { name: ctx.params.name, lang: ctx.params.lang },
	});
	if (!entry) {
		throw createError(404, "History entry not found");
	}
	const editor = await colls.users.findOne({ _id: entry.editedBy }, { projection: { "account.username": 1 } });
	ctx.body = { ...entry, editedByUsername: editor?.account.username ?? null };
});

// Upsert a page's fields, archiving the pre-edit state so a bad edit stays
// recoverable (#350). An upsert that created the page has no previous version
// to record. Returns the resulting page doc.
async function upsertPage(
	pageId: PageDoc["_id"],
	fields: Record<string, unknown>,
	editedBy: ObjectId,
): Promise<PageDoc | null> {
	const result = await colls.pages.findOneAndUpdate(
		{ _id: pageId },
		{ $set: fields },
		// "before" returns the pre-edit doc (null on a create-upsert) so it can be
		// archived — "after" would return the new content, which isn't history.
		{ upsert: true, returnDocument: "before", includeResultMetadata: true },
	);
	if (result.lastErrorObject?.updatedExisting && result.value) {
		await recordPageHistory(result.value, editedBy);
	}
	return colls.pages.findOne({ _id: pageId });
}

async function upsert(ctx: Context) {
	requirePageAccess(ctx, ctx.params.name);
	const pageId = { name: ctx.params.name, lang: ctx.params.lang };
	const fields = omit(z.record(z.string(), z.unknown()).parse(ctx.request.body), "_id", "createdAt", "updatedAt");
	// A manual save marks the translation as manually maintained — stop
	// tracking it against a source version (#306). Unset rather than omit so a
	// stale client round-tripping the field can't keep the stamp alive.
	fields.translatedFrom = null;
	ctx.body = await upsertPage(pageId, fields, ctx.state.user!._id);
}

// oxlint-disable no-async-endpoint-handlers -- Express-specific rule; Koa awaits async middleware natively
router.post("/:name/:lang", upsert);
router.put("/:name/:lang", upsert);
// oxlint-enable no-async-endpoint-handlers

const translateSchema = z.object({
	// Language of the page to create/overwrite.
	targetLang: langTag,
	// Defaults to the page's :lang (the common case: translate the page you're viewing).
	sourceLang: langTag.optional(),
});

// POST /:name/:lang/translate — LLM-translate the page into another language
// (#306), upserting {name, targetLang}. The upsert goes through the same
// history-archiving path as a manual edit, so an overwritten translation is
// recoverable from the page's history. Rate-limited per admin: every call is
// two paid LLM completions (title + content).
router.post("/:name/:lang/translate", actionRateLimit("admin/translate-page"), async (ctx) => {
	requirePageAccess(ctx, ctx.params.name);
	const { targetLang, sourceLang = ctx.params.lang } = translateSchema.parse(ctx.request.body ?? {});
	if (sourceLang === targetLang) {
		throw createError(400, "Source and target languages are the same");
	}

	const source = await colls.pages.findOne({ _id: { name: ctx.params.name, lang: sourceLang } });
	if (!source) {
		throw createError(404, `Page not found: ${ctx.params.name} (${sourceLang})`);
	}

	let title: string;
	let content: string;
	try {
		[title, content] = await Promise.all([
			translateMarkdown({
				text: source.title,
				sourceLang,
				targetLang,
				context: `title of the "${source._id.name}" page`,
			}),
			translateMarkdown({
				text: source.content,
				sourceLang,
				targetLang,
				context: `content of the "${source._id.name}" page`,
			}),
		]);
	} catch (err) {
		if (err instanceof TranslationError) {
			throw createError(err.status, err.message);
		}
		throw err;
	}

	ctx.body = await upsertPage(
		{ name: ctx.params.name, lang: targetLang },
		{
			title,
			content,
			// Track the source version this translation was produced from, so a
			// later source edit marks the translation outdated (#306).
			translatedFrom: { lang: sourceLang, updatedAt: source.updatedAt ?? new Date() },
		},
		ctx.state.user!._id,
	);
});

router.delete("/:name/:lang", async (ctx) => {
	requirePageAccess(ctx, ctx.params.name);
	const pageId = { name: ctx.params.name, lang: ctx.params.lang };
	const page = await colls.pages.findOne({ _id: pageId });
	if (page) {
		await recordPageHistory(page, ctx.state.user!._id);
	}
	await colls.pages.deleteOne({ _id: pageId });
	ctx.status = 200;
});

export default router;
