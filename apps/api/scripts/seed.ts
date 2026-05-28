import { env } from "../app/config/index.ts";
import initDb, { closeDb, db } from "../app/config/db.ts";
import * as data from "./data/index.ts";
import { fetchGameInfos } from "./fetch-gameinfos.ts";

const isTest = process.env.NODE_ENV === "test";

if (process.env.NODE_ENV !== "test") {
  env.script = true;
}

const collectionMap: Record<string, string> = {
  User: "users",
  Game: "games",
  GameInfo: "gameinfos",
  GamePreferences: "gamepreferences",
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

    let items = (data as Record<string, Record<string, unknown>[]>)[collection];

    // In dev, seed GameInfo with the latest *public* version of each game,
    // pulled live from a public BGS API. Tests stay deterministic on the
    // committed JSON fixtures, and any fetch failure falls back to them too.
    if (collection === "GameInfo" && !isTest) {
      try {
        items = await fetchGameInfos();
        console.log(`Fetched ${items.length} game info(s) from the public API`);
      } catch (err) {
        console.warn("Could not fetch game infos from the public API, falling back to local data:", err);
      }
    }

    console.log(`Inserting ${items.length} item(s) in collection ${collection}`);
    await coll.insertMany(items);
  }
}

async function run() {
  await initDb();
  await seed();
  await closeDb();
}

if (process.env.NODE_ENV !== "test") {
  void run();
}
