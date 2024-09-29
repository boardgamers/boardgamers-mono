import { LockManager } from "mongo-locks";
import env from "./env";
import { MongoClient } from "mongodb";
import { createApiErrorCollection, createChatMessageCollection, createGameCollection } from "@bgs/models";

const client = new MongoClient(env.database.bgs.url, { directConnection: true, ignoreUndefined: true });

await client.connect().catch((err) => {
  console.error("Failed to connect to database", err);
  process.exit(1);
});

const db = client.db(env.database.bgs.name);

export const collections = {
  apiErrors: await createApiErrorCollection(db),
  chatMessages: await createChatMessageCollection(db),
  games: await createGameCollection(db),
};

export const locks = new LockManager(db.collection("mongo-locks"));
