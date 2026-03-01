import assert from "node:assert/strict";
import type { Server } from "node:http";
import mongoose from "mongoose";
import { listen } from "../app.ts";
import initDb from "./db.ts";
import env from "./env.ts";

assert.strictEqual(process.env.NODE_ENV, "test");

let server: Server;
let initialized = false;

export async function setup() {
  if (initialized) {
    return;
  }
  initialized = true;

  assert.ok(env.database.bgs.name.endsWith("-test"));
  await initDb(env.database.bgs.url, false);

  const users = await mongoose.connection.db.collection("users").countDocuments();
  assert.ok(users < 10, "This doesn't seem to be a test database");

  const collections = await mongoose.connection.db.listCollections().toArray();
  await Promise.all(collections.map((c) => mongoose.connection.db.dropCollection(c.name)));

  env.listen.port.api = 50606;
  env.silent = true;

  server = await listen();
}

export async function teardown() {
  server?.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.connection.close();
}

export { env, mongoose };
