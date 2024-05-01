import type { GameInfo } from "@bgs/types";
import type { Collection, Db } from "mongodb";

export async function createGameInfoCollection(db: Db): Promise<Collection<GameInfo>> {
  const collection = db.collection<GameInfo>("gameinfos");

  await collection.createIndex({ "_id.game": 1, "_id.version": -1 });

  return collection;
}
