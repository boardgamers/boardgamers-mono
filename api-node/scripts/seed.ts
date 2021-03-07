import mongoose, { Collection } from "mongoose";
import initDb from "../app/config/db";
import * as models from "../app/models";
import data from "./seeds.json";

async function run() {
  await initDb();

  for (const collection of Object.keys(data)) {
    const coll: Collection = models[collection];

    if (!coll) {
      console.error(`Collection ${collection} is not registered in the code`);
      continue;
    }

    if ((await coll.estimatedDocumentCount()) > 0) {
      console.warn(`Collection ${collection} is not empty, skipping`);
      continue;
    }

    console.log(`Inserting ${data[collection].length} item(s) in collection ${collection}`);

    await coll.insertMany(data[collection]);
  }

  mongoose.connection.close();
}

run();
