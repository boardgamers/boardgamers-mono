import { omit } from "@bgs/utils/object";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { findGameInfoWithVersion } from "../../models/index.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/", async (ctx) => {
	ctx.body = await colls.gameInfos
		.find({}, { projection: { _id: 1, label: 1 } })
		.sort({ "_id.game": 1, "_id.version": -1 })
		.toArray();
});

// Fields that are REMOVED from the doc when the admin sends them as null (the JSON
// body can't carry undefined, so GameEdit sends null to clear). Anything else null
// would fail the collection's schema validation — only alias is clearable for now.
const NULLABLE_FIELDS = ["alias"] as const;

async function upsert(ctx: Context) {
	const body = omit(z.record(z.string(), z.unknown()).parse(ctx.request.body), "_id", "createdAt", "updatedAt");
	const $unset: Record<string, true> = {};
	for (const field of NULLABLE_FIELDS) {
		if (body[field] === null) {
			delete body[field];
			$unset[field] = true;
		}
	}
	const update: Record<string, unknown> = { $set: body };
	if (Object.keys($unset).length > 0) {
		update.$unset = $unset;
	}
	const game = await colls.gameInfos.findOneAndUpdate(
		{ _id: { game: ctx.params.game, version: +ctx.params.version } },
		update,
		{ upsert: true, returnDocument: "after" },
	);
	ctx.body = game;
}

// oxlint-disable no-async-endpoint-handlers -- Express-specific rule; Koa awaits async middleware natively
router.post("/:game/:version", upsert);
router.put("/:game/:version", upsert);
// oxlint-enable no-async-endpoint-handlers

router.delete("/:game/:version", async (ctx) => {
	await colls.gameInfos.deleteOne({ _id: { game: ctx.params.game, version: +ctx.params.version } });
	ctx.status = 200;
});

router.get("/:game/:version", async (ctx) => {
	const game = await findGameInfoWithVersion(ctx.params.game, +ctx.params.version);

	if (game) {
		ctx.body = game;
	} // else 404
});

export default router;
