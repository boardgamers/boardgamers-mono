import mongoose, { Collection } from "mongoose";
import initDb from "../app/config/db";
import * as models from "../app/models";
import * as data from "./data";

/**
 *
 * @param collections Collection names to seed. If undefined, all collections in the seed file
 */
export async function seed(collections?: string[], dropIfExists?: boolean) {
  for (const collection of collections ?? Object.keys(data)) {
    const coll: Collection = models[collection];

    if (!coll) {
      console.error(`Collection ${collection} is not registered in the code`);
      continue;
    }

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

    console.log(`Inserting ${data[collection].length} item(s) in collection ${collection}`);

    await coll.insertMany(data[collection]);
  }
}

async function run() {
  await initDb();
  await seed();

  mongoose.connection.close();
}

if (process.env.NODE_ENV !== "test") {
  run();
}
