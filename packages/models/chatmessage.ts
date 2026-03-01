import type { ChatMessage } from "@bgs/types";
import type { IndexDescription, ObjectId } from "mongodb";

export interface ChatMessageDoc extends ChatMessage<ObjectId> {}

export const CHAT_MESSAGES_COLLECTION = "chatmessages";

/** Capped collection: 100 MB */
export const chatMessagesCollectionOptions = { capped: true, size: 100 * 1000 * 1000 } as const;

export const chatMessageIndexes: IndexDescription[] = [
  // api: chat history per room; game-server: system messages
  { key: { room: 1, _id: -1 } },
];
