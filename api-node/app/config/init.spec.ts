import { Server } from "http";
import mongoose from "mongoose";
import { listen } from "../app";
import initDb from "./db";
import env from "./env";

let server: Server;

async function init() {
  await initDb(env.database.bgs.url, false);
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
