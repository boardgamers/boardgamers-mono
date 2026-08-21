import { MAX_PAGE_HISTORY_VERSIONS, canUser, canUserManageGame, pageGameSlug, type PageDoc } from "@bgs/models";
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

router.get("/", async (ctx) => {
	const pages = await colls.pages.find({}, { projection: { _id: 1 } }).toArray();
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
	ctx.body = await upsertPage(pageId, fields, ctx.state.user!._id);
}

// oxlint-disable no-async-endpoint-handlers -- Express-specific rule; Koa awaits async middleware natively
router.post("/:name/:lang", upsert);
router.put("/:name/:lang", upsert);
// oxlint-enable no-async-endpoint-handlers

const translateSchema = z.object({
	// ISO-639 2–3 letter language code of the page to create/overwrite.
	targetLang: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[a-z]{2,3}$/, "targetLang must be a 2–3 letter language code"),
	// Defaults to the page's :lang (the common case: translate the page you're viewing).
	sourceLang: z
		.string()
		.trim()
		.toLowerCase()
		.regex(/^[a-z]{2,3}$/)
		.optional(),
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

	ctx.body = await upsertPage({ name: ctx.params.name, lang: targetLang }, { title, content }, ctx.state.user!._id);
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
