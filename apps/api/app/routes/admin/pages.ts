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

const bulkTranslateJobSchema = z.object({
	// "error" is terminal too: set when the job loop itself dies (catch path)
	// or when a "running" job is found stale (server reload — the in-process
	// loop died with the process). Clients must treat both as finished.
	status: z.enum(["running", "done", "error"]),
	total: z.number(),
	done: z.number(),
	translated: z.number(),
	skipped: z.number(),
	errors: z.array(z.object({ page: z.string(), lang: z.string(), message: z.string() })),
	// The (page, lang) pair currently being processed — makes a stuck job
	// self-explaining on the translations dashboard.
	current: z.object({ page: z.string(), lang: z.string() }).optional(),
	createdAt: z.date().optional(),
	updatedAt: z.date().optional(),
	finishedAt: z.date().optional(),
});

type BulkTranslateJob = z.infer<typeof bulkTranslateJobSchema>;

// Job state lives in the settings collection, NOT in memory: the api runs as
// a PM2 cluster, so an in-memory job created by the POST on one worker 404s
// when the admin's poll lands on another. Settings docs are cheap, admin-only
// traffic is tiny, and a lost job (process reload) just means re-clicking.
const BULK_JOB_KEY_PREFIX = "bulkTranslateJob:";
// A "running" job that hasn't persisted progress in this long is dead — its
// loop died with a process reload (the job doc outlives the process). Must
// exceed BULK_PAIR_TIMEOUT_MS with margin: the max updatedAt gap of a healthy
// job is one pair timeout, and a slow-but-progressing pair must not look dead.
const BULK_JOB_STALE_MS = 15 * 60_000;
// Terminal jobs are lazily deleted after 24h when read/listed (no timers —
// a setTimeout dies with the process and the doc would linger forever).
const BULK_JOB_REAP_MS = 24 * 3600_000;
// Upper bound on one pair's LLM work: a hung provider call must not stall
// the whole job forever. translateMarkdown has its own per-request timeout
// (env.translation.timeoutMs, default 3 min) — a pair makes TWO sequential
// calls (title + content), so keep this comfortably above 2× that default:
// a slow-but-progressing pair must not be killed while its second call is
// still within its own timeout. This backstops a hang that outlives both.
const BULK_PAIR_TIMEOUT_MS = 7 * 60_000;

class PairTimeoutError extends Error {
	constructor() {
		super("Pair timed out");
		this.name = "PairTimeoutError";
	}
}

// Race a pair's work against BULK_PAIR_TIMEOUT_MS. The loser keeps running in
// the background (a resolved promise can't be cancelled) but its result is
// discarded — the loop moves on to the next pair.
function withPairTimeout<T>(work: Promise<T>): Promise<T> {
	let timer: NodeJS.Timeout;
	return Promise.race([
		work.finally(() => clearTimeout(timer)),
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new PairTimeoutError()), BULK_PAIR_TIMEOUT_MS);
			timer.unref();
		}),
	]);
}

// Mark stale "running" jobs "error" and delete old terminal jobs — lazily,
// on read/list, so reaping survives process reloads without timers. Returns
// the surviving jobs, each paired with its jobId.
async function reapAndNormalizeBulkJobs(
	docs: { _id: string; value: unknown }[],
): Promise<{ jobId: string; job: BulkTranslateJob }[]> {
	const now = Date.now();
	const jobs: { jobId: string; job: BulkTranslateJob }[] = [];
	for (const doc of docs) {
		const parsed = bulkTranslateJobSchema.safeParse(doc.value);
		if (!parsed.success) {
			continue;
		}
		const jobId = doc._id.slice(BULK_JOB_KEY_PREFIX.length);
		const job = parsed.data;
		const updatedAt = job.updatedAt?.getTime() ?? job.createdAt?.getTime() ?? now;
		if (job.status === "running" && now - updatedAt > BULK_JOB_STALE_MS) {
			job.status = "error";
			job.finishedAt = new Date(now);
			job.errors.push({ page: "*", lang: "*", message: "interrupted (server reload)" });
			await writeBulkJob(jobId, job).catch(() => {});
		} else if (job.status !== "running" && now - updatedAt > BULK_JOB_REAP_MS) {
			await colls.settings.deleteOne({ _id: doc._id }).catch(() => {});
			continue;
		}
		jobs.push({ jobId, job });
	}
	return jobs;
}

async function readBulkJob(jobId: string): Promise<BulkTranslateJob | null> {
	const doc = await colls.settings.findOne({ _id: BULK_JOB_KEY_PREFIX + jobId });
	if (!doc) {
		return null;
	}
	const [entry] = await reapAndNormalizeBulkJobs([doc]);
	return entry?.job ?? null;
}

// Exported for the translations dashboard's aggregate overview endpoint.
export async function listBulkJobs(): Promise<{ jobId: string; job: BulkTranslateJob }[]> {
	const docs = await colls.settings.find({ _id: { $regex: `^${BULK_JOB_KEY_PREFIX}` } }).toArray();
	const jobs = await reapAndNormalizeBulkJobs(docs);
	return jobs.sort((a, b) => (b.job.createdAt?.getTime() ?? 0) - (a.job.createdAt?.getTime() ?? 0));
}

async function writeBulkJob(jobId: string, job: BulkTranslateJob): Promise<void> {
	const now = new Date();
	job.updatedAt = now;
	job.createdAt ??= now;
	await colls.settings.updateOne({ _id: BULK_JOB_KEY_PREFIX + jobId }, { $set: { value: job } }, { upsert: true });
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

// The version a pair would be translated from: the requested sourceLang,
// else en, else the first version by lang. Shared by the job-creation
// filter and the job loop so both count/skip the same pairs.
function resolveSource(versions: PageDoc[], sourceLang: string): PageDoc | undefined {
	return (
		versions.find((p) => p._id.lang === sourceLang) ??
		versions.find((p) => p._id.lang === "en") ??
		versions.sort((a, b) => a._id.lang.localeCompare(b._id.lang))[0]
	);
}

// A pair is worth a (paid) translation only when there is a source version
// in another language and the target version is missing or outdated.
function needsTranslation(versions: PageDoc[], targetLang: string, sourceLang: string): boolean {
	const source = resolveSource(versions, sourceLang);
	if (!source || source._id.lang === targetLang) {
		return false;
	}
	const existing = versions.find((p) => p._id.lang === targetLang);
	return !existing || isOutdated(existing, source);
}

async function runBulkTranslateJob(
	jobId: string,
	job: BulkTranslateJob,
	pairs: { name: string; targetLang: string }[],
	sourceLang: string,
	editedBy: ObjectId,
) {
	for (const { name, targetLang } of pairs) {
		job.current = { page: name, lang: targetLang };
		await writeBulkJob(jobId, job);
		try {
			await withPairTimeout(
				(async () => {
					const versions = await colls.pages.find({ "_id.name": name }).toArray();
					// Keep this in-loop check as a safety net: pages can be edited
					// between job creation (which pre-filters pairs with the same
					// predicate) and processing.
					if (!needsTranslation(versions, targetLang, sourceLang)) {
						job.skipped++;
						return;
					}
					// oxlint-disable-next-line typescript/no-non-null-assertion -- needsTranslation guarantees a source in another language
					const source = resolveSource(versions, sourceLang)!;
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
						{
							title,
							content,
							translatedFrom: { lang: source._id.lang, updatedAt: source.updatedAt ?? new Date() },
						},
						editedBy,
					);
					job.translated++;
				})(),
			);
		} catch (err) {
			const message =
				err instanceof PairTimeoutError
					? `timed out after ${Math.round(BULK_PAIR_TIMEOUT_MS / 60_000)} min`
					: err instanceof Error
						? err.message
						: String(err);
			job.errors.push({ page: name, lang: targetLang, message });
		} finally {
			job.done++;
			// Persist progress per pair so polls from other cluster workers see it.
			await writeBulkJob(jobId, job);
		}
	}
	// `current = undefined` would round-trip through Mongo as null and fail
	// the schema on the next read — actually remove the key.
	delete job.current;
	job.status = "done";
	job.finishedAt = new Date();
	await writeBulkJob(jobId, job);
}

// POST /translate-bulk — kick off a bulk translation run (#306): either
// {targetLang} for "every page missing/outdated in that language" or
// {pageName} for "that page into every supported locale where missing or
// outdated". Returns 202 + a job id; poll GET /translate-bulk/:jobId.
router.post("/translate-bulk", actionRateLimit("admin/translate-bulk"), async (ctx) => {
	const { targetLang, pageName, sourceLang = "en" } = bulkTranslateSchema.parse(ctx.request.body ?? {});

	const pages = await colls.pages.find({}, { projection: { _id: 1 } }).toArray();
	const names = [...new Set(pages.map((p) => p._id.name))].filter((name) => canManagePage(ctx.state.user, name));

	let candidates: { name: string; targetLang: string }[];
	if (targetLang) {
		candidates = names.map((name) => ({ name, targetLang }));
	} else {
		// oxlint-disable-next-line typescript/no-non-null-assertion -- the refine guarantees pageName when targetLang is absent
		const name = pageName!;
		if (!canManagePage(ctx.state.user, name)) {
			throw createError(403, "Missing admin permission: pages");
		}
		candidates = locales.map((lang) => ({ name, targetLang: lang }));
	}

	// Count only pairs that will actually be translated (missing or outdated
	// target version) so the progress total isn't inflated by up-to-date
	// pages — the sidebar shows done/total. One $in fetch covers every
	// candidate page; the job loop re-checks each pair as a safety net.
	const versionsByName = new Map<string, PageDoc[]>();
	for (const version of await colls.pages
		.find({ "_id.name": { $in: [...new Set(candidates.map((c) => c.name))] } })
		.toArray()) {
		const list = versionsByName.get(version._id.name) ?? [];
		list.push(version);
		versionsByName.set(version._id.name, list);
	}
	const pairs = candidates.filter(({ name, targetLang: lang }) =>
		needsTranslation(versionsByName.get(name) ?? [], lang, sourceLang),
	);
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
	await writeBulkJob(jobId, job);
	void runBulkTranslateJob(jobId, job, pairs, sourceLang, ctx.state.user!._id).catch(async (err) => {
		job.status = "error";
		job.finishedAt = new Date();
		job.errors.push({ page: "*", lang: "*", message: err instanceof Error ? err.message : String(err) });
		await writeBulkJob(jobId, job).catch(() => {});
	});

	ctx.status = 202;
	ctx.body = { jobId, total: job.total };
});

router.get("/translate-bulk/:jobId", async (ctx) => {
	const job = await readBulkJob(ctx.params.jobId);
	if (!job) {
		throw createError(404, "Job not found");
	}
	ctx.body = job;
});

// All bulk jobs, newest first — the translations dashboard's jobs table.
// Reaping is lazy: stale "running" jobs come back as "error" (interrupted),
// terminal jobs older than BULK_JOB_REAP_MS are deleted and omitted.
// Registered AFTER /translate-bulk/:jobId: koa-router matches in declaration
// order, and the param route would otherwise swallow this exact path.
router.get("/translate-bulk", async (ctx) => {
	ctx.body = (await listBulkJobs()).map(({ jobId, job }) => ({ jobId, ...job }));
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
