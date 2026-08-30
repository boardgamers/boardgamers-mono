// Room-generic chat route handlers (#91): the same message/edit/reaction/lastRead
// logic backs both the game rooms (/api/game/:gameId/chat…, participant-gated) and
// the public rooms (/api/room/:roomId/chat…, any logged-in user). Callers do the
// room-level auth BEFORE delegating here; these handlers only know the room id.
import assert from "node:assert";
import createError from "http-errors";
import type { Context } from "koa";
import { ObjectId, type WithId } from "mongodb";
import { z } from "zod";
import {
	boardgameFromRoomId,
	chatKillSwitchModeSchema,
	isPublicChatRoom,
	chatReactionEmojiSchema,
	SettingsKey,
	type ChatKillSwitchMode,
	type ChatMessageDoc,
	type RoomMetaDataDoc,
	type UserDoc,
} from "@bgs/models";
import { colls } from "../config/db.ts";
import { chatReactionAggregates, setChatReaction } from "../services/chatreaction.ts";
import { zObjectId } from "../utils/zod.ts";

// Editing your own text messages, within a window: long enough to fix typos or a wrong
// mention, short enough that the conversation others replied to isn't rewritten under them.
export const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000;

// Which kind of room the caller routes to: game chat (participant-gated, /api/game)
// or a public room (/api/room). Passed by the callers rather than inferred from the
// room id so the moderation checks don't depend on the room id scheme.
export type ChatRoomScope = "game" | "public";

export async function chatKillSwitchMode(): Promise<ChatKillSwitchMode> {
	const setting = await colls.settings.findOne({ _id: SettingsKey.ChatKillSwitch });
	const parsed = chatKillSwitchModeSchema.safeParse(setting?.value);
	return parsed.success ? parsed.data : "off";
}

// Every chat WRITE (post/edit/reaction, both room kinds) funnels through here;
// reading history and lastRead tracking stay available. Ordered mute-first: a
// muted user is told about their mute even while a room is disabled.
async function assertChatWritable(user: WithId<UserDoc>, room: string, scope: ChatRoomScope): Promise<void> {
	if (user.chatMutedUntil && user.chatMutedUntil.getTime() > Date.now()) {
		// Crude permanence heuristic for the message only (a "permanent" mute is a
		// far-future date, see CHAT_MUTE_DURATIONS) — the check above is the rule.
		const permanent = user.chatMutedUntil.getTime() - Date.now() > 50 * 365 * 24 * 60 * 60 * 1000;
		throw createError(
			403,
			permanent
				? "You are muted from chat by a moderator."
				: `You are muted from chat by a moderator until ${user.chatMutedUntil.toISOString()}.`,
		);
	}

	const mode = await chatKillSwitchMode();
	if (mode === "all" || (mode === "public" && scope === "public")) {
		throw createError(403, "Chat is temporarily disabled site-wide.");
	}

	if (scope === "public") {
		const boardgame = boardgameFromRoomId(room);
		if (boardgame) {
			const meta = await colls.gameMetadatas.findOne({ _id: boardgame }, { projection: { chatDisabled: 1 } });
			if (meta?.chatDisabled) {
				throw createError(403, "Chat is disabled for this boardgame.");
			}
		}
	}
}

// Is the room's chat currently OFF for everyone (kill switch / per-boardgame flag)?
// Read-only variant of assertChatWritable used by the ws server to tell joining
// clients to replace the input with a "disabled" notice. Per-user mutes are
// deliberately not included — those surface as a 403 on the attempted action.
export async function isChatDisabledForRoom(room: string): Promise<boolean> {
	const boardgame = boardgameFromRoomId(room);
	// No caller scope here (the ws room subscription is just a string) — the
	// shape-level isPublicChatRoom (lobby or boardgame namespace) decides.
	const mode = await chatKillSwitchMode();
	if (mode === "all" || (mode === "public" && isPublicChatRoom(room))) {
		return true;
	}
	if (boardgame) {
		const meta = await colls.gameMetadatas.findOne({ _id: boardgame }, { projection: { chatDisabled: 1 } });
		return meta?.chatDisabled === true;
	}
	return false;
}

export async function postChatMessage(ctx: Context, room: string, scope: ChatRoomScope): Promise<void> {
	// Plain koa Context types `state` loosely — the callers' loggedIn middleware guarantees it.
	const user: WithId<UserDoc> = ctx.state.user;
	await assertChatWritable(user, room, scope);
	const body = z
		.object({
			type: z.enum(["text", "emoji"]),
			data: z.object({ text: z.string().min(1, "Empty chat message") }),
		})
		.parse(ctx.request.body);

	await colls.chatMessages.insertOne({
		_id: new ObjectId(),
		room,
		author: {
			_id: user._id,
			name: user.account.username,
		},
		data: {
			text: body.data.text,
		},
		type: body.type,
	});
	ctx.status = 200;
}

export async function editChatMessage(ctx: Context, room: string, scope: ChatRoomScope): Promise<void> {
	const user: WithId<UserDoc> = ctx.state.user;
	await assertChatWritable(user, room, scope);
	const body = z
		.object({
			data: z.object({ text: z.string().min(1, "Empty chat message") }),
		})
		.parse(ctx.request.body);

	assert(ObjectId.isValid(ctx.params.messageId), "Invalid message id");
	const messageId = new ObjectId(ctx.params.messageId);

	const message = await colls.chatMessages.findOne({ _id: messageId, room });
	if (!message) {
		throw createError(404, "Message not found");
	}
	assert(message.type === "text", "Only text messages can be edited");
	assert(message.author?._id.equals(user._id), "You can only edit your own messages");
	assert(Date.now() - messageId.getTimestamp().getTime() <= CHAT_EDIT_WINDOW_MS, "The edit window has passed");

	// Capped collection: size-changing updates are fine on MongoDB ≥ 5.0 (see @bgs/models).
	// editedAt drives both the "(edited)" marker and the ws poller's update broadcast.
	await colls.chatMessages.updateOne(
		{ _id: messageId },
		{ $set: { "data.text": body.data.text, editedAt: new Date() } },
	);
	ctx.status = 200;
}

// Toggle an emoji reaction on a chat message (#438). PUT sets, DELETE unsets —
// both idempotent (like boardgame/like). The emoji travels in the path
// (URL-encoded) so the DELETE stays body-less.
export async function toggleChatReaction(
	ctx: Context,
	room: string,
	active: boolean,
	scope: ChatRoomScope,
): Promise<void> {
	const user: WithId<UserDoc> = ctx.state.user;
	await assertChatWritable(user, room, scope);
	const { messageId, emoji } = z
		.object({ messageId: zObjectId(), emoji: chatReactionEmojiSchema })
		.parse({ messageId: ctx.params.messageId, emoji: ctx.params.emoji });

	const message = await colls.chatMessages.findOne({ _id: messageId, room }, { projection: { _id: 1 } });
	if (!message) {
		throw createError(404, "Chat message not found");
	}

	await setChatReaction({
		message: messageId,
		room,
		user: user._id,
		userName: user.account.username,
		emoji,
		active,
	});
	ctx.body = (await chatReactionAggregates([messageId]))[0];
}

// Admin moderation (#444-adjacent): hard-delete a chat message. Site-admin-only —
// the CALLERS gate on authority === "admin" (and audit-log the action); this
// handler only knows the room id. Mongo ≥ 5.0 allows deletes on capped collections
// (prod runs 8.0; verified empirically in the moderation spec, like #433 did for
// updates). The message's reaction docs are deleted too — orphans are tolerated
// by the aggregates, but cleaning them is cleaner. A tombstone is dropped into
// `chatdeletions` so the ws poller can broadcast a `deletedMessages` command
// (deleted docs are invisible to its watermark queries); old clients ignore
// unknown commands, same deploy-safe pattern as #433's updatedMessages.
export async function deleteChatMessage(ctx: Context, room: string): Promise<WithId<ChatMessageDoc>> {
	const messageId = zObjectId().parse(ctx.params.messageId);

	const message = await colls.chatMessages.findOne({ _id: messageId, room });
	if (!message) {
		throw createError(404, "Chat message not found");
	}

	await colls.chatMessages.deleteOne({ _id: messageId });
	await colls.chatReactions.deleteMany({ message: messageId });
	await colls.chatDeletions.insertOne({ _id: new ObjectId(), room, message: messageId, deletedAt: new Date() });

	ctx.status = 200;
	// Returned so the callers can enrich their audit event with what was deleted.
	return message;
}

export async function getChatLastRead(ctx: Context, room: string): Promise<void> {
	const user: WithId<UserDoc> = ctx.state.user;
	const metaData: RoomMetaDataDoc | null = await colls.roomMetaData.findOne({
		room,
		user: user._id,
	});

	if (!metaData || !metaData.lastChatMessageViewed) {
		ctx.body = 0;
	} else {
		ctx.body = new Date(metaData.lastChatMessageViewed).getTime();
	}
}

export async function postChatLastRead(ctx: Context, room: string): Promise<void> {
	const user: WithId<UserDoc> = ctx.state.user;
	const { lastRead } = z.object({ lastRead: z.union([z.string(), z.number()]) }).parse(ctx.request.body);
	await colls.roomMetaData.updateOne(
		{ room, user: user._id },
		{ $set: { lastChatMessageViewed: new Date(lastRead) } },
		{ upsert: true },
	);
	ctx.status = 200;
}
