import createError from "http-errors";
import {
	canUser,
	canUserManageGame,
	feedbackKindSchema,
	feedbackStatusSchema,
	type FeedbackRequestDoc,
} from "@bgs/models";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import env from "../../config/env.ts";
import { actionRateLimit } from "../../services/actionratelimit.ts";
import { likedFeedbackRequestIds, setFeedbackRequestLike } from "../../services/feedbacklike.ts";
import { createFeedbackTopic, forumUidForUser } from "../../services/forum.ts";
import { zObjectId } from "../../utils/zod.ts";
import { loggedIn, usernamesById } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

// Basic spam guard (#340): no karma minimum to request, so cap how many open
// requests a user can have (on top of the actionRateLimit).
const MAX_OPEN_FEEDBACK_REQUESTS_PER_USER = 10;

const createBodySchema = z.object({
	kind: feedbackKindSchema,
	game: z.string().max(214).optional(),
	title: z.string().min(3).max(200),
	body: z.string().max(5000).optional(),
});

router.post("/", loggedIn, actionRateLimit("feedback/create"), async (ctx) => {
	const { kind, game, title, body } = createBodySchema.parse(ctx.request.body);
	const user = ctx.state.user!;

	if (kind === "game") {
		if (!game) {
			throw createError(400, 'A game request needs its "game" id');
		}
		// Only implemented games accept game-specific requests — requesting an
		// expansion on a game that doesn't exist yet makes no sense (vote on the
		// whole-game request instead).
		const exists = await colls.gameMetadatas.findOne(
			{ _id: game, status: { $ne: "requested" } },
			{ projection: { _id: 1 } },
		);
		if (!exists) {
			throw createError(404, `Unknown game "${game}"`);
		}
	}

	const openRequests = await colls.feedbackRequests.countDocuments({
		requestedBy: user._id,
		$or: [{ status: "open" }, { status: { $exists: false } }],
	});
	if (openRequests >= MAX_OPEN_FEEDBACK_REQUESTS_PER_USER) {
		throw createError(429, `You already have ${MAX_OPEN_FEEDBACK_REQUESTS_PER_USER} open requests`);
	}

	// Site + game-specific feedback is posted on the forum AS the user (#340), so
	// they need a linked forum account (created lazily via BGS OAuth on first
	// forum login). Hard gate: without one the frontend starts the linking flow.
	// (Whole-game requests gate the same way in the boardgame routes.)
	const forumUid = await forumUidForUser(user._id);
	if (forumUid === null) {
		throw createError(403, "Link your forum account to submit feedback", { code: "forum_account_required" });
	}

	// Create the forum discussion topic FIRST, posted AS the requester (#340). The
	// request only exists once its topic does: a forum failure aborts the whole
	// request (503) and nothing is persisted — there is no topic-less fallback.
	const topic = await createFeedbackTopic({
		title,
		body,
		requestUrl: `https://${env.site}/feedback`,
		username: user.account.username,
		forumUid,
	});
	if (!topic) {
		throw createError(503, "Could not create the forum topic — please try again later");
	}

	const doc: FeedbackRequestDoc = {
		kind,
		...(kind === "game" ? { game: game! } : {}),
		title,
		...(body ? { body } : {}),
		requestedBy: user._id,
		likeCount: 0,
		status: "open",
		forumTid: topic.tid,
	};
	const { insertedId } = await colls.feedbackRequests.insertOne(doc);

	ctx.status = 201;
	ctx.body = { ...doc, _id: insertedId, liked: false };
});

const listQuerySchema = z.object({
	kind: feedbackKindSchema,
	game: z.string().optional(),
});

router.get("/", async (ctx) => {
	const { kind, game } = listQuerySchema.parse(ctx.query);
	if (kind === "game" && !game) {
		throw createError(400, 'Listing game requests needs the "game" query parameter');
	}

	const requests = await colls.feedbackRequests
		.find(kind === "game" ? { kind, game: game! } : { kind })
		.sort({ likeCount: -1, createdAt: 1 })
		.toArray();

	const liked = ctx.state.user ? await likedFeedbackRequestIds(ctx.state.user._id) : new Set<string>();
	const requesterNames = await usernamesById(requests.map((r) => r.requestedBy));

	ctx.body = requests.map((r) => ({
		...r,
		likeCount: r.likeCount ?? 0,
		status: r.status ?? "open",
		liked: liked.has(r._id.toHexString()),
		requestedBy: requesterNames.get(r.requestedBy.toHexString()),
	}));
});

router.param("id", async (id, ctx, next) => {
	const { _id: requestId } = z.object({ _id: zObjectId() }).parse({ _id: id });
	const request = await colls.feedbackRequests.findOne({ _id: requestId });
	if (!request) {
		throw createError(404, "Feedback request not found");
	}
	ctx.state.foundFeedbackRequest = request;
	await next();
});

router.put("/:id/like", loggedIn, actionRateLimit("feedback/like"), async (ctx) => {
	ctx.body = await setFeedbackRequestLike(ctx.state.foundFeedbackRequest!._id, ctx.state.user!._id, true);
});

router.delete("/:id/like", loggedIn, actionRateLimit("feedback/like"), async (ctx) => {
	ctx.body = await setFeedbackRequestLike(ctx.state.foundFeedbackRequest!._id, ctx.state.user!._id, false);
});

const statusBodySchema = z.object({
	status: feedbackStatusSchema,
});

// Status triage: blanket "feedback" admins, plus per-boardgame admins on the
// requests of the game(s) they manage (site feedback stays blanket-only).
router.patch("/:id/status", async (ctx) => {
	const request = ctx.state.foundFeedbackRequest!;
	if (!canUser(ctx.state.user, "feedback") && !(request.game && canUserManageGame(ctx.state.user, request.game))) {
		throw createError(403, "Missing admin permission: feedback");
	}
	const { status } = statusBodySchema.parse(ctx.request.body);
	const updated = await colls.feedbackRequests.findOneAndUpdate(
		{ _id: ctx.state.foundFeedbackRequest!._id },
		{ $set: { status } },
		{ returnDocument: "after" },
	);
	// Same serialization as the listing: status defaults to "open", liked is
	// per-user (serialization-only).
	const liked = ctx.state.user ? await likedFeedbackRequestIds(ctx.state.user._id) : new Set<string>();
	ctx.body = updated
		? {
				...updated,
				likeCount: updated.likeCount ?? 0,
				status: updated.status ?? "open",
				liked: liked.has(updated._id.toHexString()),
			}
		: updated;
});

export default router;
