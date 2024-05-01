import type { Game } from "@bgs/types";
import type { Collection, Db, ObjectId } from "mongodb";

export async function createGameCollection(db: Db): Promise<Collection<Game<ObjectId>>> {
  const collection = db.collection<Game<ObjectId>>("games");

  await collection.createIndex({ status: 1, lastMove: -1 });
  await collection.createIndex({ "players._id": 1, lastMove: -1 });
  await collection.createIndex(
    { status: 1, scheduledStart: 1 },
    { partialFilterExpression: { status: "open", "options.timing.scheduledStart": { $exists: true } } }
  );

  await collection.createIndex({ creator: 1 });
  await collection.createIndex({ lastMove: -1 });
  await collection.createIndex({ "currentPlayers._id": 1 });
  await collection.createIndex({ "currentPlayers._deadline": -1 });

  // For websocket server. To find whether games have updated
  await collection.createIndex({ updatedAt: -1 });

  return collection;
}
