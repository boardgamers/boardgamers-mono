import { randomUUID } from "node:crypto";
import type { ChangelogDoc } from "@bgs/models";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import {
	changelogNeedsTranslation,
	changelogSourceHash,
	changelogSourceStrings,
	changelogTargetLangs,
} from "../../models/changelog-i18n.ts";
import { changelogInputSchema } from "../../models/index.ts";
import { actionRateLimit } from "../../services/actionratelimit.ts";
import { isTranslationConfigured, translateMarkdown } from "../../services/translate.ts";
import { type BulkPair, type BulkTranslateJob, readBulkJob, startBulkJob, writeBulkJob } from "./bulkjob.ts";

const router = new Router<Application.DefaultState, Context>();

// -- LLM translation (#306 follow-up) -----------------------------------------
//
// Changelog entries get the same per-language overlay treatment as game
// metadata: translations live in `translations.<lang>` on the doc, stamped
// with the source-text hash for outdated-tracking, and the public routes serve
// the winning string per request language. Translation runs as a bulk job
// (same settings-doc shape and dashboard jobs table as pages/metadata) —
// entries are cheap (a one-liner + optional details), but a run can span
// many entries × languages. Gated by the "changelog" permission (the mount's
// requirePermission): changelog admins own the content, translations included.

// Defensive cap on (entry, language) pairs per run — every pair is up to two
// paid LLM completions. Sized so a full refresh of the recent history fits.
const BULK_CHANGELOG_MAX_PAIRS = 200;

function changelogTranslatePairs(entries: ChangelogDoc[], targetLangs: string[]): BulkPair[] {
	return entries.flatMap((doc) =>
		targetLangs
			.filter((lang) => changelogNeedsTranslation(doc, lang))
			// oxlint-disable-next-line typescript/no-non-null-assertion -- entries come from the db, where _id is always set
			.map((lang) => ({ item: doc._id!.toHexString(), lang })),
	);
}

// Kick off a changelog translate job over the given pairs (202-style: the
// caller answers immediately, the loop runs in the background and polls read
// progress from the shared job doc). The per-pair work re-checks the
// needs-translation predicate against a fresh read, so concurrent runs (or an
// edit mid-run) degrade to skips, not double-paid completions.
async function launchChangelogTranslateJob(pairs: BulkPair[]): Promise<{ jobId: string; total: number }> {
	const job: BulkTranslateJob = {
		status: "running",
		kind: "changelog",
		total: pairs.length,
		done: 0,
		translated: 0,
		skipped: 0,
		errors: [],
	};
	const jobId = randomUUID();
	await writeBulkJob(jobId, job);
	startBulkJob(jobId, job, pairs, async ({ item, lang }) => {
		const doc = await colls.changelogs.findOne({ _id: new ObjectId(item) });
		// In-loop re-check, same predicate as pair creation. Unpublishing
		// mid-run also degrades to a skip — drafts aren't translated.
		if (!doc || !doc.published || !changelogNeedsTranslation(doc, lang)) {
			return "skipped";
		}
		const source = changelogSourceStrings(doc);
		const overlay = Object.fromEntries(
			await Promise.all(
				Object.entries(source).map(async ([field, text]) => [
					field,
					await translateMarkdown({
						text,
						sourceLang: "en",
						targetLang: lang,
						context: field === "content" ? "changelog entry (a short one-liner)" : "changelog entry details",
					}),
				]),
			),
		);
		// Same $set overlay path — and the same translatedFrom.hash stamp — as
		// the metadata translate routes, so overlays get outdated-tracking.
		await colls.changelogs.updateOne(
			{ _id: doc._id },
			{ $set: { [`translations.${lang}`]: { ...overlay, translatedFrom: { hash: changelogSourceHash(source) } } } },
		);
		return "translated";
	});
	return { jobId, total: pairs.length };
}

// Auto-translate on publish: whenever a create/update leaves an entry
// published, fire-and-forget a translate job for its missing/outdated
// languages — the workflow that actually keeps changelogs translated, without
// blocking the admin's save. Idempotent: the needs-translation predicate
// yields no pairs when the entry is already fully translated (then no job doc
// is even written), and the in-loop re-check de-dupes concurrent runs. Not
// rate-limited: it's server-initiated, bounded by one entry × the locale set,
// and publishing is itself a rare, trusted admin action. No-op when the LLM
// isn't configured (local dev) — the admin can still translate manually later.
function autoTranslateOnPublish(doc: ChangelogDoc): void {
	if (!doc.published || !isTranslationConfigured()) {
		return;
	}
	const pairs = changelogTranslatePairs([doc], changelogTargetLangs());
	if (pairs.length === 0) {
		return;
	}
	void launchChangelogTranslateJob(pairs).catch((err) => {
		console.error(`auto-translate of changelog entry ${doc._id?.toHexString()} failed to start`, err);
	});
}

const bulkTranslateSchema = z.object({
	// One language across all published entries; omitted = every language.
	targetLang: z
		.string()
		.trim()
		.regex(/^[a-z]{2,3}$/, "targetLang must be a base language subtag (2–3 lowercase letters)")
		.optional(),
	// One entry into every (or the given) language — the admin UI's per-entry
	// "Translate" button.
	entryId: z
		.string()
		.regex(/^[a-f\d]{24}$/i)
		.optional(),
});

// POST /api/admin/changelog/translate-bulk — LLM-translate published changelog
// entries: {entryId} for one entry, {targetLang} for one language across all
// published entries, {} for every missing/outdated (entry, language) pair.
// 202 + job id, polled via GET /translate-bulk/:jobId below; the job also
// shows on the translations dashboard. Drafts are excluded — they get
// translated when published (autoTranslateOnPublish).
router.post("/translate-bulk", actionRateLimit("admin/translate-changelog-bulk"), async (ctx) => {
	const { targetLang, entryId } = bulkTranslateSchema.parse(ctx.request.body ?? {});

	let entries: ChangelogDoc[];
	if (entryId) {
		const entry = await colls.changelogs.findOne({ _id: new ObjectId(entryId) });
		if (!entry) {
			throw createError(404, "Changelog entry not found");
		}
		if (!entry.published) {
			throw createError(400, "Drafts are not translated — publish the entry first");
		}
		entries = [entry];
	} else {
		entries = await colls.changelogs.find({ published: true }).sort({ createdAt: -1 }).toArray();
	}

	const pairs = changelogTranslatePairs(entries, targetLang ? [targetLang] : changelogTargetLangs());
	if (pairs.length > BULK_CHANGELOG_MAX_PAIRS) {
		throw createError(400, `Too many (entry, language) pairs: ${pairs.length} > ${BULK_CHANGELOG_MAX_PAIRS}`);
	}

	const { jobId, total } = await launchChangelogTranslateJob(pairs);
	ctx.status = 202;
	ctx.body = { jobId, total };
});

// GET /api/admin/changelog/translate-bulk/:jobId — poll a translate job. Same
// lazy reap/normalize semantics as the pages variant; mounted here so
// changelog admins (who may not hold "pages") can poll their own jobs.
router.get("/translate-bulk/:jobId", async (ctx) => {
	const job = await readBulkJob(ctx.params.jobId);
	if (!job) {
		throw createError(404, "Job not found");
	}
	ctx.body = job;
});

// GET /api/admin/changelog — all entries, newest first (unpublished included)
router.get("/", async (ctx) => {
	ctx.body = await colls.changelogs.find({}).sort({ createdAt: -1 }).toArray();
});

// POST /api/admin/changelog — { content, details?, github?, published? } → the
// created entry. A new entry simply sorts above older ones by createdAt.
router.post("/", async (ctx) => {
	const { content, details, github, published } = changelogInputSchema
		.extend({ published: changelogInputSchema.shape.published.default(true) })
		.parse(ctx.request.body);

	const doc = {
		_id: new ObjectId(),
		content,
		...(details ? { details } : {}),
		...(github ? { github } : {}),
		published,
		createdAt: new Date(),
	};
	await colls.changelogs.insertOne(doc);
	autoTranslateOnPublish(doc);

	ctx.status = 201;
	ctx.body = doc;
});

// Empty string clears an optional field ($unset below); undefined leaves it.
// github stays http(s)-only like the schema (raw <a href> target).
const updateSchema = changelogInputSchema
	.partial()
	.extend({ details: z.string().trim().optional(), github: z.httpUrl().or(z.literal("")).optional() });

// PUT /api/admin/changelog/:id — edit content/details/github/published. createdAt
// is immutable: an entry keeps its place in the timeline.
router.put("/:id", async (ctx) => {
	const { id } = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).parse(ctx.params);
	const changes = updateSchema.refine((c) => Object.keys(c).length > 0, "No changes provided").parse(ctx.request.body);

	const unset: Record<string, ""> = {};
	for (const key of ["details", "github"] as const) {
		if (changes[key] === "") {
			unset[key] = "";
			delete changes[key];
		}
	}

	const updated = await colls.changelogs.findOneAndUpdate(
		{ _id: new ObjectId(id) },
		{
			...(Object.keys(changes).length > 0 ? { $set: changes } : {}),
			...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
		},
		// Post-image: the auto-translate decision needs the published flag and
		// source text as they are AFTER this edit (a content edit on a
		// published entry re-translates the now-outdated overlays).
		{ returnDocument: "after" },
	);
	if (!updated) {
		throw createError(404, "Changelog entry not found");
	}
	autoTranslateOnPublish(updated);
	ctx.status = 200;
});

router.delete("/:id", async (ctx) => {
	const { id } = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }).parse(ctx.params);

	const { deletedCount } = await colls.changelogs.deleteOne({ _id: new ObjectId(id) });
	if (!deletedCount) {
		throw createError(404, "Changelog entry not found");
	}
	ctx.status = 200;
});

export default router;
