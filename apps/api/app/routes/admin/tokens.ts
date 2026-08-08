import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { createAdminToken, MAX_ADMIN_TOKEN_TTL_MS } from "../../models/index.ts";

const DAY_MS = 24 * 3600 * 1000;
const MAX_TTL_DAYS = MAX_ADMIN_TOKEN_TTL_MS / DAY_MS;

const router = new Router<Application.DefaultState, Context>();

// Personal, temporary credentials for scripting admin APIs (issue #105). Each
// admin manages their own tokens; the raw token is shown exactly once here —
// only its sha256 hash is stored.
const createTokenSchema = z.object({
	name: z.string().trim().min(1).max(100),
	ttlDays: z
		.number()
		.min(1 / DAY_MS)
		.max(MAX_TTL_DAYS)
		.default(30),
});

// POST /api/admin/tokens — { name, ttlDays? } → the raw token, once
router.post("/", async (ctx) => {
	const { name, ttlDays } = createTokenSchema.parse(ctx.request.body);

	const { doc, token } = await createAdminToken(ctx.state.user!._id, name, ttlDays * DAY_MS);

	ctx.status = 201;
	ctx.body = {
		_id: doc._id,
		name: doc.name,
		createdAt: doc.createdAt,
		expiresAt: doc.expiresAt,
		token,
	};
});

// GET /api/admin/tokens — own tokens, without the hash
router.get("/", async (ctx) => {
	ctx.body = await colls.adminTokens
		.find(
			{ user: ctx.state.user!._id },
			{ projection: { name: 1, createdAt: 1, expiresAt: 1, lastUsedAt: 1, revokedAt: 1 } },
		)
		.sort({ createdAt: -1 })
		.toArray();
});

// DELETE /api/admin/tokens/:id — revoke one of the caller's own tokens
router.delete("/:id", async (ctx) => {
	const { matchedCount } = await colls.adminTokens.updateOne(
		{ _id: new ObjectId(ctx.params.id), user: ctx.state.user!._id, revokedAt: { $exists: false } },
		{ $set: { revokedAt: new Date() } },
	);

	if (!matchedCount) {
		throw createError(404, "Token not found");
	}

	ctx.status = 200;
});

export default router;
