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
});

export type ChatMessageDoc = z.output<typeof chatMessageSchema>;
export type ChatMessageFront = Jsonify<ChatMessageDoc>;

export const CHAT_MESSAGES_COLLECTION = "chatmessages";

export const chatMessagesCollectionOptions = { size: 100 * 1000 * 1000 };

export const chatMessageIndexes: IndexDescription[] = [
  // api: chat history per room; game-server: system messages
  { key: { room: 1, _id: -1 } },
];
