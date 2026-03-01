import type { Collection } from "mongodb";
import { env } from "../app/config/index.ts";
import initDb, { closeDb, db } from "../app/config/db.ts";
import * as data from "./data/index.ts";

if (process.env.NODE_ENV !== "test") {
  env.script = true;
}

const collectionMap: Record<string, string> = {
  users: "users",
  games: "games",
  gameInfos: "gameinfos",
  gamePreferences: "gamepreferences",
  chatMessages: "chatmessages",
  settings: "settings",
  pages: "pages",
};

export async function seed(collections?: string[], dropIfExists?: boolean) {
  for (const collection of collections ?? Object.keys(data)) {
    const collName = collectionMap[collection];
    if (!collName) {
      console.error(`Collection ${collection} is not mapped`);
      continue;
    }

    const coll = db().collection(collName);

    if (!(collection in data)) {
      console.error(`Collection ${collection} does not have a seeding file`);
      continue;
    }

    if (dropIfExists) {
      await coll.deleteMany({});
    } else if ((await coll.estimatedDocumentCount()) > 0) {
      console.warn(`Collection ${collection} is not empty, skipping`);
      continue;
    }

    console.log(`Inserting ${(data as any)[collection].length} item(s) in collection ${collection}`);
    await coll.insertMany((data as any)[collection]);
  }
}

async function run() {
  await initDb();
  await seed();
  await closeDb();
}

if (process.env.NODE_ENV !== "test") {
  run();
}
