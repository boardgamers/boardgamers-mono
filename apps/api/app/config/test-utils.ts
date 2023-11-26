import assert from "assert";
import { Server } from "http";
import env from "./env";
import initDb from "./db";
import mongoose from "mongoose";
import { listen } from "../app";

let server: Server;
assert(process.env.NODE_ENV === "test");

assert(env.database.bgs.name.endsWith("-test"));

env.listen.port.api = 50606;
env.silent = true;

export async function setupForTest() {
  await initDb(env.database.bgs.url, false);

  const users = await mongoose.connection.db.collection("users").countDocuments();
  assert(users < 10, "This doesn't seem to be a test database");
  await mongoose.connection.db.dropDatabase();

  server = await listen();
}

export async function teardownForTest() {
  server?.close();
  server = undefined;
  await mongoose.connection.db.dropDatabase();
  await mongoose.connection.close();
}
