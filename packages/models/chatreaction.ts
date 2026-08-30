import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";
import { chatReactionEmojiSchema } from "./chatreaction-emoji.ts";

// Browser-safe constants/types (emoji whitelist, aggregate wire shape) live in
// ./chatreaction-emoji.ts — the web app imports that subpath directly.
export {
	CHAT_REACTION_EMOJI,
	CHAT_REACTION_QUICK,
	MAX_CHAT_REACTIONS_PER_MESSAGE,
	chatReactionEmojiSchema,
	type ChatReactionAggregate,
} from "./chatreaction-emoji.ts";

// One doc per (message, user, emoji). `chatmessages` is a capped collection
// (documents can't grow, can't be deleted), so reactions live in their own
// collection keyed by message id. Unsetting flips `active` to false instead of
// deleting: the websocket layer polls `updatedAt` to push live updates, and a
// hard delete would be invisible to that watermark. Orphaned reactions (message
// rolled out of the cap) are harmless and bounded by the emoji whitelist.
export const chatReactionSchema = z.object({
	_id: zObjectId().optional(),
	message: zObjectId(),
	room: z.string(),
	user: zObjectId(),
	userName: z.string(),
	emoji: chatReactionEmojiSchema,
	active: z.boolean(),
	createdAt: zDate().optional(),
	updatedAt: zDate().optional(),
});

export type ChatReactionDoc = z.output<typeof chatReactionSchema>;

export const CHAT_REACTIONS_COLLECTION = "chatreactions";

export const chatReactionIndexes: IndexDescription[] = [
	// One doc per (message, user, emoji); also the toggle's upsert target and the
	// prefix every aggregate fetch ($in on message ids) walks
	{ key: { message: 1, user: 1, emoji: 1 }, unique: true },
	// Websocket watermark poll for live delivery (ws.ts)
	{ key: { updatedAt: 1 } },
];
