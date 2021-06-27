import assert from "assert";
import { Server } from "http";
import mongoose from "mongoose";
import { listen } from "../app";
import initDb from "./db";
import env from "./env";

assert(process.env.NODE_ENV === "test");

let server: Server;

async function init() {
  assert(env.database.bgs.name.endsWith("-test"));
  await initDb(env.database.bgs.url, false);

  const users = await mongoose.connection.db.collection("users").countDocuments();
  assert(users < 10, "This doesn't seem to be a test database");
  await mongoose.connection.db.dropDatabase();

  env.listen.port.api = 50606;
  env.silent = true;

  server = await listen();

  run();
}

init();

after(async () => {
  server.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.connection.close();
});
