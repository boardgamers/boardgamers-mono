import { z } from "zod";
import type { Jsonify } from "type-fest";
import type { IndexDescription } from "mongodb";
import { zObjectId } from "./helpers.ts";

export const chatMessageSchema = z.object({
	_id: zObjectId().optional(),
	room: z.string(),
	author: z
		.object({
			_id: zObjectId(),
			name: z.string(),
		})
		.optional(),
	data: z.object({
		text: z.string(),
	}),
	type: z.enum(["text", "emoji", "system"]),
	editedAt: z.date().optional(),
});

export type ChatMessageDoc = z.output<typeof chatMessageSchema>;
export type ChatMessageFront = Jsonify<ChatMessageDoc>;

export const CHAT_MESSAGES_COLLECTION = "chatmessages";

// Still capped: MongoDB ≥ 5.0 allows size-changing updates (and deletes) on capped
// collections, so message editing works in place (prod runs 8.0) — no migration to a
// regular collection needed. The cap keeps handling size (100 MB, ~0.1% used in prod).
export const chatMessagesCollectionOptions = { size: 100 * 1000 * 1000 };

export const chatMessageIndexes: IndexDescription[] = [
	// api: chat history per room; game-server: system messages
	{ key: { room: 1, _id: -1 } },
	// api ws poller: broadcast edited messages; partial — only edited docs carry the field
	{ key: { editedAt: 1 }, partialFilterExpression: { editedAt: { $exists: true } } },
];
