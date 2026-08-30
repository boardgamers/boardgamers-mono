import { MAX_CHAT_REACTIONS_PER_MESSAGE, type ChatReactionAggregate } from "@bgs/models";
import createError from "http-errors";
import type { ObjectId } from "mongodb";
import { colls } from "../config/db.ts";

const DUPLICATE_KEY = 11000;

/**
 * Idempotent set/unset of one (message, user, emoji) reaction, mirroring the
 * boardgame/feedback like services. Reactions live in their own collection
 * (`chatmessages` is capped — its docs can't grow), and unsetting flips
 * `active` to false instead of deleting so the websocket layer's `updatedAt`
 * watermark poll (ws.ts) sees removals too. `updatedAt` only moves when the
 * state actually flips, so a repeated set/unset doesn't re-trigger pushes.
 */
export async function setChatReaction(params: {
	message: ObjectId;
	room: string;
	user: ObjectId;
	userName: string;
	emoji: string;
	active: boolean;
}): Promise<void> {
	const { message, room, user, userName, emoji, active } = params;

	if (!active) {
		await colls.chatReactions.updateOne({ message, user, emoji, active: true }, { $set: { active: false } });
		return;
	}

	// Cap distinct active emoji per (message, user). Checked before the write —
	// two concurrent sets can overshoot by one, which is harmless for a spam bound.
	const distinct = await colls.chatReactions.countDocuments({ message, user, active: true, emoji: { $ne: emoji } });
	if (distinct >= MAX_CHAT_REACTIONS_PER_MESSAGE) {
		throw createError(400, `You can react with at most ${MAX_CHAT_REACTIONS_PER_MESSAGE} emoji per message`);
	}

	try {
		await colls.chatReactions.updateOne(
			// `active: { $ne: true }` keeps an already-active reaction untouched (no
			// updatedAt bump → no websocket re-push); the miss then upserts…
			{ message, user, emoji, active: { $ne: true } },
			{ $set: { active: true, userName }, $setOnInsert: { room, createdAt: new Date() } },
			{ upsert: true },
		);
	} catch (err) {
		// …and when the doc exists AND is already active, the upsert insert hits
		// the unique (message, user, emoji) index — which just means "already set".
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- caught errors are untyped; the driver sets `code`
		if ((err as { code?: number })?.code !== DUPLICATE_KEY) {
			throw err;
		}
	}
}

/**
 * Current reactions of the given messages, one aggregate per REQUESTED id (so a
 * message whose last reaction was just removed yields `reactions: []` and
 * clients know to clear it). Emoji groups and users keep first-reaction order.
 */
export async function chatReactionAggregates(messages: ObjectId[]): Promise<ChatReactionAggregate[]> {
	if (messages.length === 0) {
		return [];
	}

	const docs = await colls.chatReactions
		.find({ message: { $in: messages }, active: true })
		.sort({ _id: 1 })
		.project<{ message: ObjectId; user: ObjectId; userName: string; emoji: string }>({
			message: 1,
			user: 1,
			userName: 1,
			emoji: 1,
		})
		.toArray();

	const byMessage = new Map<string, ChatReactionAggregate>(
		messages.map((id) => [id.toHexString(), { message: id.toHexString(), reactions: [] }]),
	);

	for (const doc of docs) {
		const aggregate = byMessage.get(doc.message.toHexString());
		if (!aggregate) {
			continue;
		}
		let group = aggregate.reactions.find((r) => r.emoji === doc.emoji);
		if (!group) {
			group = { emoji: doc.emoji, users: [] };
			aggregate.reactions.push(group);
		}
		group.users.push({ _id: doc.user.toHexString(), name: doc.userName });
	}

	return [...byMessage.values()];
}
