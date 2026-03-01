import cluster from "cluster";
import mongoose from "mongoose";
import locks from "./locks.ts";
import { migrate } from "../models/migrations.ts";
import env from "./env.ts";

mongoose.Promise = global.Promise; // native promises

let dbInit = false;

export default async function initDb(url = env.database.bgs.url, runMigrations = true) {
  if (dbInit) {
    console.log("DB already initialized");
    return;
  }

  dbInit = true;

  const connect = () =>
    mongoose
      .connect(url, { dbName: env.database.bgs.name, directConnection: true })
      .then(() => console.log("successfully connected to database"));
  await connect();

  locks.init(mongoose.connection.db!.collection("locks"));

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

  mongoose.connection.on("error", (err) => {
    console.error("db error", err);
  });

  if (!env.script) {
    mongoose.connection.on("disconnected", () => {
      console.log("attempt to reconnect to database");
      setTimeout(() => connect().catch(console.error), 5000);
    });
  }
}
