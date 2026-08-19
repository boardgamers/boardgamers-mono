import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

// Site feature requests + game-specific requests (expansions/options/UI) — #340.
// Whole-game requests are NOT here: they are `gameMetadatas` docs with
// status "requested" (voted on with the regular gamelike mechanic). Bugs go via
// Discord, not this system.
export const feedbackKindSchema = z.enum(["site", "game"]);

export type FeedbackKind = z.output<typeof feedbackKindSchema>;

// Admin-managed lifecycle. Absent = "open" (every pre-status doc).
export const feedbackStatusSchema = z.enum(["open", "planned", "done", "declined"]);

export type FeedbackStatus = z.output<typeof feedbackStatusSchema>;

export const feedbackRequestSchema = z.object({
	_id: zObjectId().optional(),
	kind: feedbackKindSchema,
	// The game id (gameMetadatas._id) — required for kind "game", absent for "site".
	game: z.string().optional(),
	title: z.string().min(1).max(200),
	body: z.string().max(5000).optional(),
	requestedBy: zObjectId(),
	// Server-maintained denormalized vote count (feedbackRequestLikes), never
	// edited directly.
	likeCount: z.number().int().min(0).optional(),
	status: feedbackStatusSchema.optional(),
	// Linked NodeBB topic id (Comments & Feedback category) — stored/returned when
	// set; the actual topic creation is wired separately.
	forumTid: z.number().int().optional(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type FeedbackRequestDoc = z.output<typeof feedbackRequestSchema>;
export type FeedbackRequestFront = Jsonify<FeedbackRequestDoc>;

export const FEEDBACK_REQUESTS_COLLECTION = "feedbackrequests";

export const feedbackRequestIndexes: IndexDescription[] = [
	// Listing per kind, most-liked first
	{ key: { kind: 1, likeCount: -1 } },
	// Game-specific requests on the boardgame page
	{ key: { game: 1 } },
	// "My requests" + the open-requests-per-user spam guard
	{ key: { requestedBy: 1 } },
];

// One doc per (request, user) pair — a user voting on a feedback request.
export const feedbackRequestLikeSchema = z.object({
	_id: zObjectId().optional(),
	request: zObjectId(),
	user: zObjectId(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type FeedbackRequestLikeDoc = z.output<typeof feedbackRequestLikeSchema>;
export type FeedbackRequestLikeFront = Jsonify<FeedbackRequestLikeDoc>;

export const FEEDBACK_REQUEST_LIKES_COLLECTION = "feedbackrequestlikes";

export const feedbackRequestLikeIndexes: IndexDescription[] = [
	// One vote per (request, user); also serves per-request countDocuments
	{ key: { request: 1, user: 1 }, unique: true },
	// "Requests this user voted for" (liked flags in listings)
	{ key: { user: 1 } },
];
