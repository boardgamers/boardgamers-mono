import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { canUser, feedbackKindSchema, feedbackStatusSchema, isGameAdminGrant, userPermissions } from "@bgs/models";
import { colls } from "../../config/db.ts";
import { usernamesById } from "../utils.ts";
import { auditLog } from "./audit.ts";

const router = new Router<Application.DefaultState, Context>();

// The mount gate lets per-boardgame admins through; per-game actions re-check
// the target against their granted games here. Blanket "feedback" admins (and
// full admins) act on any request.
function grantedGameIds(ctx: Context): string[] | null {
	if (canUser(ctx.state.user, "feedback")) {
		return null;
	}
	return [...userPermissions(ctx.state.user)].flatMap((p) =>
		isGameAdminGrant(p) ? [p.slice("gameinfo:".length)] : [],
	);
}

function requireGameRequestAccess(ctx: Context, game: string) {
	const granted = grantedGameIds(ctx);
	if (granted && !granted.includes(game)) {
		throw createError(403, `Missing admin permission: gameinfo:${game}`);
	}
}

const listQuerySchema = z.object({
	kind: feedbackKindSchema.optional(),
	status: feedbackStatusSchema.optional(),
	game: z.string().optional(),
});

// GET /api/admin/feedback — every feedback request across kinds and games in
// one call (the public /api/feedback listing is scoped to one kind/game).
// Optional kind/status/game filters; "open" also matches pre-status docs.
// The mount gate lets per-boardgame admins through: their listing is scoped
// to the games their `gameinfo:<game>` grants cover (site feedback and other
// games' requests stay out; a game filter outside their scope just matches
// nothing). Blanket "feedback" admins see everything.
router.get("/", async (ctx) => {
	const { kind, status, game } = listQuerySchema.parse(ctx.query);

	const filter: Record<string, unknown> = {};
	if (kind) {
		filter.kind = kind;
	}
	if (game) {
		filter.game = game;
	}
	if (status) {
		filter.$or = status === "open" ? [{ status: "open" }, { status: { $exists: false } }] : [{ status }];
	}

	const grantedGames = grantedGameIds(ctx);
	if (grantedGames) {
		// `game` is parsed from the query string; even when it matches a granted
		// game, scoping goes through $in so a tainted query object can never
		// widen the filter.
		filter.game = { $in: game ? grantedGames.filter((g) => g === game) : grantedGames };
	}

	// Admin triage order: most-liked first, newest first on ties (the public
	// listing breaks ties oldest-first).
	const requests = await colls.feedbackRequests.find(filter).sort({ likeCount: -1, createdAt: -1 }).toArray();
	const requesterNames = await usernamesById(requests.map((r) => r.requestedBy));

	ctx.body = requests.map((r) => ({
		...r,
		likeCount: r.likeCount ?? 0,
		status: r.status ?? "open",
		requestedBy: requesterNames.get(r.requestedBy.toHexString()),
	}));
});

// A game request is only admin-manageable while it has no implementation:
// status "requested" AND no version docs. The version-doc check is
// defence-in-depth against a race with a version upload flipping the status
// to "beta" between the listing and the action.
async function loadRequestedGame(game: string) {
	const doc = await colls.gameMetadatas.findOne({ _id: game });
	if (!doc || doc.status !== "requested") {
		throw createError(404, `No open game request for "${game}"`);
	}
	if (await colls.gameInfos.findOne({ "_id.game": game }, { projection: { _id: 1 } })) {
		throw createError(409, `"${game}" has an implementation — manage it from the boardgame page`);
	}
	return doc;
}

// GET /api/admin/feedback/game-requests — whole-game requests (#340), most
// voted first. Per-boardgame admins only see their granted games' requests.
router.get("/game-requests", async (ctx) => {
	const granted = grantedGameIds(ctx);
	const requests = await colls.gameMetadatas
		.find(
			{ status: "requested", ...(granted ? { _id: { $in: granted } } : {}) },
			{ projection: { label: 1, description: 1, likeCount: 1, requestedBy: 1, forumTid: 1, createdAt: 1 } },
		)
		.sort({ likeCount: -1, createdAt: -1 })
		.toArray();
	const requesterNames = await usernamesById(requests.flatMap((r) => (r.requestedBy ? [r.requestedBy] : [])));

	ctx.body = requests.map((r) => ({
		_id: r._id,
		label: r.label,
		...(r.description ? { description: r.description } : {}),
		likeCount: r.likeCount ?? 0,
		...(r.requestedBy ? { requestedBy: requesterNames.get(r.requestedBy.toHexString()) } : {}),
		...(r.forumTid !== undefined ? { forumTid: r.forumTid } : {}),
		createdAt: r.createdAt,
	}));
});

// DELETE /api/admin/feedback/game-requests/:game — remove the request and its
// votes. The linked forum topic is left alone.
router.delete("/game-requests/:game", async (ctx) => {
	const { game } = ctx.params;
	requireGameRequestAccess(ctx, game);
	await loadRequestedGame(game);

	await colls.gameLikes.deleteMany({ game });
	await colls.gameMetadatas.deleteOne({ _id: game });
	auditLog(ctx, "feedback.deleteGameRequest", { kind: "gameRequest", id: game });
	ctx.status = 204;
});

const mergeBodySchema = z.object({ into: z.string().min(1) });

// The merge target is broader than the source: another open request, or an
// existing game implementation (any gameMetadatas doc that is not a bare
// request — it has version docs, or its status is "beta"/"implemented"/absent).
// A "requested" doc with version docs is in neither bucket (a version upload
// raced the request): 409, same as the source-side race.
async function loadMergeTarget(game: string) {
	const doc = await colls.gameMetadatas.findOne({ _id: game });
	if (!doc) {
		throw createError(404, `No game or open game request for "${game}"`);
	}
	const hasVersions = !!(await colls.gameInfos.findOne({ "_id.game": game }, { projection: { _id: 1 } }));
	if (doc.status === "requested" && hasVersions) {
		throw createError(409, `"${game}" has an implementation — manage it from the boardgame page`);
	}
	return doc;
}

// POST /api/admin/feedback/game-requests/:game/merge — fold the request into
// another request or into an existing game: its votes move over (a user who
// already voted for the target keeps a single vote), the target's likeCount is
// exactly recounted, and the source request is deleted. The target's own
// metadata (status, label, …) is untouched; both forum topics are left alone.
router.post("/game-requests/:game/merge", async (ctx) => {
	const { game } = ctx.params;
	const { into } = mergeBodySchema.parse(ctx.request.body);
	if (game === into) {
		throw createError(400, "Cannot merge a game request into itself");
	}
	requireGameRequestAccess(ctx, game);
	requireGameRequestAccess(ctx, into);
	await loadRequestedGame(game);
	await loadMergeTarget(into);

	// Drop the source votes that would collide with an existing target vote
	// (the {game, user} unique index), then re-point the rest.
	const targetLikers = await colls.gameLikes.distinct("user", { game: into });
	if (targetLikers.length > 0) {
		await colls.gameLikes.deleteMany({ game, user: { $in: targetLikers } });
	}
	await colls.gameLikes.updateMany({ game }, { $set: { game: into } });

	// Exact recount rather than $inc arithmetic: the denormalized counter can't
	// drift from the deduplication above.
	const likeCount = await colls.gameLikes.countDocuments({ game: into });
	await colls.gameMetadatas.updateOne({ _id: into }, { $set: { likeCount } });
	await colls.gameMetadatas.deleteOne({ _id: game });

	auditLog(ctx, "feedback.mergeGameRequest", { kind: "gameRequest", id: game }, { into, likeCount });
	ctx.body = { into, likeCount };
});

export default router;
