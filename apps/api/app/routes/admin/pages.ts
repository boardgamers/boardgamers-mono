import { MAX_PAGE_HISTORY_VERSIONS, type PageDoc } from "@bgs/models";
import { omit } from "@bgs/utils/object";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";

const router = new Router<Application.DefaultState, Context>();

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
	ctx.body = await colls.pages.find({}, { projection: { _id: 1 } }).toArray();
});

router.get("/:name/:lang", async (ctx) => {
	const page = await colls.pages.findOne({ _id: { name: ctx.params.name, lang: ctx.params.lang } });
	if (page) {
		ctx.body = page;
	} // else 404
});

// Past versions of the page, newest first, without the (markdown) bodies.
// `editedBy` is resolved to the editor's username for display.
router.get("/:name/:lang/history", async (ctx) => {
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

async function upsert(ctx: Context) {
	const pageId = { name: ctx.params.name, lang: ctx.params.lang };
	const result = await colls.pages.findOneAndUpdate(
		{ _id: pageId },
		{ $set: omit(z.record(z.string(), z.unknown()).parse(ctx.request.body), "_id", "createdAt", "updatedAt") },
		// "before" returns the pre-edit doc (null on a create-upsert) so it can be
		// archived — "after" would return the new content, which isn't history.
		{ upsert: true, returnDocument: "before", includeResultMetadata: true },
	);
	// Archive the pre-edit state so a bad edit stays recoverable (#350). An
	// upsert that created the page has no previous version to record.
	if (result.lastErrorObject?.updatedExisting && result.value) {
		await recordPageHistory(result.value, ctx.state.user!._id);
	}
	ctx.body = await colls.pages.findOne({ _id: pageId });
}

// oxlint-disable no-async-endpoint-handlers -- Express-specific rule; Koa awaits async middleware natively
router.post("/:name/:lang", upsert);
router.put("/:name/:lang", upsert);
// oxlint-enable no-async-endpoint-handlers

router.delete("/:name/:lang", async (ctx) => {
	const pageId = { name: ctx.params.name, lang: ctx.params.lang };
	const page = await colls.pages.findOne({ _id: pageId });
	if (page) {
		await recordPageHistory(page, ctx.state.user!._id);
	}
	await colls.pages.deleteOne({ _id: pageId });
	ctx.status = 200;
});

export default router;
