import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { canUser, feedbackKindSchema, feedbackStatusSchema, isGameAdminGrant, userPermissions } from "@bgs/models";
import { colls } from "../../config/db.ts";
import { usernamesById } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

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

	if (!canUser(ctx.state.user, "feedback")) {
		const grantedGames = [...userPermissions(ctx.state.user)].flatMap((p) =>
			isGameAdminGrant(p) ? [p.slice("gameinfo:".length)] : [],
		);
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

export default router;
