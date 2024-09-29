import type { ChatMessage } from "@bgs/types";
import type { Db, Collection, ObjectId } from "mongodb";

export async function createChatMessageCollection(db: Db): Promise<Collection<ChatMessage<ObjectId>>> {
  // We only keep 100MB of chat logs
  const collection = await db.createCollection<ChatMessage<ObjectId>>("chatmessages", {
    capped: true,
    size: 100 * 1024 * 1024,
  });

  await collection.createIndex({ room: 1, _id: -1 });
  await collection.createIndex({ "author._id": 1, _id: -1 });

  return collection;
}
