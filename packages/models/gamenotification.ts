import type { GameNotification } from "@bgs/types";
import type { Collection, Db, ObjectId } from "mongodb";

export async function createGameNotificationCollection(db: Db): Promise<Collection<GameNotification<ObjectId>>> {
  const collection = db.collection<GameNotification<ObjectId>>("gamenotifications");

  await collection.createIndex({ processed: 1, kind: 1 });
  await collection.createIndex({ kind: 1 });
  await collection.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 3600 * 24 * 30 });

  return collection;
}
