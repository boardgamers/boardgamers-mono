import cluster from "cluster";
import { LockManager } from "mongo-locks";
import { migrate } from "../models/migrations";
import env from "./env";
import { MongoClient } from "mongodb";
import {
  createApiErrorCollection,
  createChatMessageCollection,
  createGameCollection,
  createGameInfoCollection,
  createGameNotificationCollection,
} from "@bgs/models";
import { createUserCollection } from "../models";

const client = new MongoClient(env.database.bgs.url, { directConnection: true, ignoreUndefined: true });

export const db = client.db(env.database.bgs.name);

export const locks = new LockManager(db.collection("mongo-locks"));

await db
  .listCollections()
  .toArray()
  .then(() => {
    console.log("Connected to database");
  });

export const collections = {
  apiErrors: await createApiErrorCollection(db),
  chatMessages: await createChatMessageCollection(db),
  games: await createGameCollection(db),
  gameNotifications: await createGameNotificationCollection(db),
  gameInfos: await createGameInfoCollection(db),
  users: await createUserCollection(db),
};

if (!env.isTest && cluster.isMaster) {
  await using lock = await locks.lock("db");

  if (lock) {
    await migrate();
  }
}
