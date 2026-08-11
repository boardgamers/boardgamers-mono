import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { changelogInputSchema } from "../../models/index.ts";

const router = new Router<Application.DefaultState, Context>();

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
	);
	if (!updated) {
		throw createError(404, "Changelog entry not found");
	}
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
