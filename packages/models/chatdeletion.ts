import { z } from "zod";
import type { IndexDescription } from "mongodb";
import { zObjectId, zDate } from "./helpers.ts";

// Tombstones for admin-deleted chat messages. The message doc itself is
// hard-deleted from the capped `chatmessages` collection (Mongo ≥ 5.0 allows
// it), which the ws poller's watermark queries can't see — so the delete
// route drops one of these markers and the poller broadcasts them to open
// clients as a `deletedMessages` command. Only needed for that live push:
// history reloads simply no longer contain the message, hence the short TTL.
export const chatDeletionSchema = z.object({
	_id: zObjectId().optional(),
	room: z.string(),
	message: zObjectId(),
	deletedAt: zDate(),
});

export type ChatDeletionDoc = z.output<typeof chatDeletionSchema>;

export const CHAT_DELETIONS_COLLECTION = "chatdeletions";

export const chatDeletionIndexes: IndexDescription[] = [
	// TTL only — the api ws poller reads by `_id > watermark` (default index)
	{ key: { deletedAt: 1 }, expireAfterSeconds: 3600 },
];
