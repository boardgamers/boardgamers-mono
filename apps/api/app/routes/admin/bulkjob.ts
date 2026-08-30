import { colls } from "../../config/db.ts";
import { z } from "zod";

// Shared infrastructure for the LLM bulk-translation jobs (#306): one job doc
// shape in the settings collection, one monitoring surface (the translations
// dashboard's jobs table lists every job, whatever it translates).
//
// A job's unit of work is a PAIR — (page, lang) for CMS pages, (game, lang)
// for game metadata. Pairs are generically keyed ({item, lang}); the job doc
// keeps the wire field names `page`/`current.page` so pre-existing page jobs
// (and the dashboard rendering them) stay valid — for a metadata job, `page`
// simply carries the game id.
export interface BulkPair {
	item: string;
	lang: string;
}

export const bulkTranslateJobSchema = z.object({
	// "error" is terminal too: set when the job loop itself dies (catch path)
	// or when a "running" job is found stale (server reload — the in-process
	// loop died with the process). Clients must treat both as finished.
	status: z.enum(["running", "done", "error"]),
	// What the job translates. Absent on pre-kind jobs, which are all page
	// jobs — parse them as "pages" so old docs stay listable.
	kind: z.enum(["pages", "metadata", "changelog"]).default("pages"),
	total: z.number(),
	done: z.number(),
	translated: z.number(),
	skipped: z.number(),
	errors: z.array(z.object({ page: z.string(), lang: z.string(), message: z.string() })),
	// The pair currently being processed — makes a stuck job self-explaining
	// on the translations dashboard.
	current: z.object({ page: z.string(), lang: z.string() }).optional(),
	createdAt: z.date().optional(),
	updatedAt: z.date().optional(),
	finishedAt: z.date().optional(),
});

export type BulkTranslateJob = z.infer<typeof bulkTranslateJobSchema>;

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
// (env.translation.timeoutMs, default 3 min) — a pair makes up to THREE
// sequential-ish calls (page: title + content, metadata: description/rules/
// credits, all Promise.all'd), so keep this comfortably above that default:
// a slow-but-progressing pair must not be killed while a call is still
// within its own timeout. This backstops a hang that outlives it.
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

export async function readBulkJob(jobId: string): Promise<BulkTranslateJob | null> {
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

export async function writeBulkJob(jobId: string, job: BulkTranslateJob): Promise<void> {
	const now = new Date();
	job.updatedAt = now;
	job.createdAt ??= now;
	await colls.settings.updateOne({ _id: BULK_JOB_KEY_PREFIX + jobId }, { $set: { value: job } }, { upsert: true });
}

// The job loop shared by the pages and metadata bulk-translate routes: walk
// the pairs sequentially (failures stay isolated per pair, no burst of paid
// completions against the provider), persist progress per pair so polls from
// other cluster workers see it, and land the job "done" at the end. The
// per-pair work — skip check, LLM calls, write — is the route's.
export async function runBulkTranslateJob(
	jobId: string,
	job: BulkTranslateJob,
	pairs: BulkPair[],
	processPair: (pair: BulkPair) => Promise<"translated" | "skipped">,
) {
	for (const pair of pairs) {
		job.current = { page: pair.item, lang: pair.lang };
		await writeBulkJob(jobId, job);
		try {
			const outcome = await withPairTimeout(processPair(pair));
			if (outcome === "skipped") {
				job.skipped++;
			} else {
				job.translated++;
			}
		} catch (err) {
			const message =
				err instanceof PairTimeoutError
					? `timed out after ${Math.round(BULK_PAIR_TIMEOUT_MS / 60_000)} min`
					: err instanceof Error
						? err.message
						: String(err);
			job.errors.push({ page: pair.item, lang: pair.lang, message });
		} finally {
			job.done++;
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

// Kick off a freshly-created job: persist it, run its loop in the background
// (the POST answers 202 immediately; the client polls), and land it "error"
// if the loop itself dies. Centralizes the catch path both routes share.
export function startBulkJob(
	jobId: string,
	job: BulkTranslateJob,
	pairs: BulkPair[],
	processPair: (pair: BulkPair) => Promise<"translated" | "skipped">,
): void {
	void runBulkTranslateJob(jobId, job, pairs, processPair).catch(async (err) => {
		job.status = "error";
		job.finishedAt = new Date();
		job.errors.push({ page: "*", lang: "*", message: err instanceof Error ? err.message : String(err) });
		await writeBulkJob(jobId, job).catch(() => {});
	});
}
