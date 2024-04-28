import cluster from "cluster";
import { LockManager } from "mongo-locks";
import { migrate } from "../models/migrations";
import env from "./env";
import { MongoClient } from "mongodb";

const client = new MongoClient(env.database.bgs.url, { directConnection: true, ignoreUndefined: true });

const db = client.db(env.database.bgs.name);

const locks = new LockManager(db.collection("mongo-locks"));

await db
  .listCollections()
  .toArray()
  .then(() => {
    console.log("Connected to database");
  });

export const collections = {};

if (!env.isTest && cluster.isMaster) {
  await using lock = await locks.lock("db");

  if (lock) {
    await migrate();
  }
}
