import assert from "node:assert/strict";
import type { Server } from "node:http";
import { listen } from "../app.ts";
import initDb, { closeDb, db } from "./db.ts";
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

  const users = await db().collection("users").countDocuments();
  assert.ok(users < 10, "This doesn't seem to be a test database");

  const collections = await db().listCollections().toArray();
  await Promise.all(collections.map((c) => db().dropCollection(c.name)));

  env.listen.port.api = 0;
  // Bind explicitly to 127.0.0.1 so the address the tests fetch (also 127.0.0.1
  // via "localhost") matches the one the server is bound to. Otherwise on hosts
  // where `localhost` resolves to ::1 first (e.g. some Linux containers),
  // app.listen("localhost") binds only ::1 while undici's fetch dials 127.0.0.1
  // → ECONNREFUSED.
  env.listen.host = "127.0.0.1";
  env.silent = true;

  server = await listen();
  const addr = server.address();
  if (addr && typeof addr === "object") {
    env.listen.port.api = addr.port;
  }
}

export async function teardown() {
  server?.close();
  await db().dropDatabase();
  await closeDb();
}

export { env };
