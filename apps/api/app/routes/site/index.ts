import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { requestLanguage } from "../../models/changelog-i18n.ts";
import {
	ANNOUNCEMENT_ENTRY_COUNT,
	announcementFromChangelog,
	latestChangelogs,
	SettingsKey,
	seedChangelogsFromAnnouncement,
} from "../../models/index.ts";

const router = new Router<Application.DefaultState, Context>();

const changelogQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(50).default(ANNOUNCEMENT_ENTRY_COUNT),
	// Cursor: an ISO date — the next page holds entries strictly older than it.
	before: z.iso.datetime().optional(),
});

// GET /api/site/changelog — latest published entries, newest first, localized
// to the request's content language (#306: lang cookie → Accept-Language →
// "en", base subtag; per-field English fallback — see models/changelog-i18n).
// Lazily backfills from the legacy announcement blob when the collection is
// empty: pre-#184 dbs get their history without waiting for api-cron, and the
// migration's own empty check makes the seed-once guarantee race-safe.
router.get("/changelog", async (ctx) => {
	const { limit, before } = changelogQuerySchema.parse(ctx.query);
	if (!before) {
		await seedChangelogsFromAnnouncement();
	}
	ctx.body = await latestChangelogs(limit, before ? new Date(before) : undefined, requestLanguage(ctx));
});

// The homepage announcement box: the latest changelog one-liners joined into
// { content } (the "Recent changes" header is fixed in the homepage markup),
// localized like /changelog above. Falls back to the stored legacy blob when
// there are no entries at all (e.g. an announcement written by hand but never
// migrated).
router.get("/announcement", async (ctx) => {
	ctx.body =
		(await announcementFromChangelog(requestLanguage(ctx))) ??
		(await colls.settings.findOne({ _id: SettingsKey.Announcement }))?.value;
});

const errorReportSchema = z.object({
	name: z.string().max(200).default("Error"),
	message: z.string().max(2000),
	stack: z.array(z.string().max(500)).max(50).default([]),
	url: z.string().max(500),
	gameId: z.string().max(100).optional(),
	release: z.string().max(100).optional(),
});

// POST /api/site/errors/report — client-side (browser) error reports. Auth-optional:
// logged-out users hit frontend errors too, so we accept anonymous reports. Stored in
// the same apierrors collection as server errors, tagged meta.source = "web-client".
router.post("/errors/report", async (ctx) => {
	const report = errorReportSchema.parse(ctx.request.body);

	await colls.apiErrors.insertOne({
		error: {
			name: report.name,
			message: report.message,
			stack: report.stack,
		},
		request: {
			url: report.url,
			method: "CLIENT",
			body: "",
		},
		user: ctx.state.user?._id,
		meta: {
			source: "web-client",
			userAgent: ctx.get("user-agent")?.slice(0, 300),
			gameId: report.gameId,
			release: report.release ?? process.env.APP_RELEASE,
		},
		createdAt: new Date(),
	});

	ctx.status = 204;
});

export default router;
