import cluster from "cluster";
import locks from "mongo-locks";
import mongoose from "mongoose";
import { migrate } from "../models/migrations";
import env from "./env";

mongoose.Promise = global.Promise; // native promises

let dbInit = false;

export default async function initDb(url = env.database.bgs.url, runMigrations = true) {
  if (dbInit) {
    console.log("DB already initialized");
    return;
  }

  dbInit = true;

  await mongoose.connect(url, { dbName: env.database.bgs.name, useNewUrlParser: true });
  locks.init(mongoose.connection);

  if (cluster.isMaster && runMigrations) {
    let free = () => {};
    try {
      free = await locks.lock("migration");
      await migrate();
    } catch (err) {
      console.error(err);
    } finally {
      free();
    }
  }
}
