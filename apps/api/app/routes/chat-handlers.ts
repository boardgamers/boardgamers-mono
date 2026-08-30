// Room-generic chat route handlers (#91): the same message/edit/reaction/lastRead
// logic backs both the game rooms (/api/game/:gameId/chat…, participant-gated) and
// the public rooms (/api/room/:roomId/chat…, any logged-in user). Callers do the
// room-level auth BEFORE delegating here; these handlers only know the room id.
import assert from "node:assert";
import createError from "http-errors";
import type { Context } from "koa";
import { ObjectId, type WithId } from "mongodb";
import { z } from "zod";
import { chatReactionEmojiSchema, type RoomMetaDataDoc, type UserDoc } from "@bgs/models";
import { colls } from "../config/db.ts";
import { chatReactionAggregates, setChatReaction } from "../services/chatreaction.ts";
import { zObjectId } from "../utils/zod.ts";

// Editing your own text messages, within a window: long enough to fix typos or a wrong
// mention, short enough that the conversation others replied to isn't rewritten under them.
export const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000;

export async function postChatMessage(ctx: Context, room: string): Promise<void> {
	// Plain koa Context types `state` loosely — the callers' loggedIn middleware guarantees it.
	const user: WithId<UserDoc> = ctx.state.user;
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

export async function editChatMessage(ctx: Context, room: string): Promise<void> {
	const user: WithId<UserDoc> = ctx.state.user;
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
export async function toggleChatReaction(ctx: Context, room: string, active: boolean): Promise<void> {
	const user: WithId<UserDoc> = ctx.state.user;
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
