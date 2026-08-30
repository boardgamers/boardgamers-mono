// Public chat rooms (#91): one persistent room per public boardgame
// ("boardgame:<slug>"), plus the dormant site-wide lobby. Same chat data layer
// and ws push as game rooms (rooms are plain string ids), but the auth differs —
// any logged-in (confirmed) user can post, no game-participant check. Room ids
// are validated per request (isOpenPublicChatRoom): everything outside the
// public namespace, or a boardgame without a public version, 404s — otherwise
// this router would open a chat room on any string.
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { isOpenPublicChatRoom } from "../../services/chatroom.ts";
import { actionRateLimit } from "../../services/actionratelimit.ts";
import { isConfirmed, loggedIn } from "../utils.ts";
import {
	editChatMessage,
	getChatLastRead,
	postChatLastRead,
	postChatMessage,
	toggleChatReaction,
} from "../chat-handlers.ts";

const router = new Router<Application.DefaultState, Context>();

router.param("roomId", async (roomId, ctx, next) => {
	if (!(await isOpenPublicChatRoom(roomId))) {
		throw createError(404, "Unknown room: " + roomId);
	}
	await next();
});

// Rate-limited (room/chat-message) unlike game chat: public rooms are open to
// every logged-in user — see ACTION_RATE_LIMITS for the rationale.
router.post("/:roomId/chat", loggedIn, isConfirmed, actionRateLimit("room/chat-message"), (ctx) =>
	postChatMessage(ctx, ctx.params.roomId),
);

// Author-only, same 15-minute window as game chat (enforced in the shared handler).
router.patch("/:roomId/chat/:messageId", loggedIn, isConfirmed, (ctx) => editChatMessage(ctx, ctx.params.roomId));

router.put(
	"/:roomId/chat/:messageId/reaction/:emoji",
	loggedIn,
	isConfirmed,
	actionRateLimit("room/chat-reaction"),
	(ctx) => toggleChatReaction(ctx, ctx.params.roomId, true),
);

router.delete(
	"/:roomId/chat/:messageId/reaction/:emoji",
	loggedIn,
	isConfirmed,
	actionRateLimit("room/chat-reaction"),
	(ctx) => toggleChatReaction(ctx, ctx.params.roomId, false),
);

router.get("/:roomId/chat/lastRead", loggedIn, (ctx) => getChatLastRead(ctx, ctx.params.roomId));

router.post("/:roomId/chat/lastRead", loggedIn, (ctx) => postChatLastRead(ctx, ctx.params.roomId));

export default router;
