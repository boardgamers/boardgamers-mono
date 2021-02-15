import { Server } from "http";
import mongoUnit from "mongo-unit";
import mongoose from "mongoose";
import { listen } from "../app";
import initDb from "./db";
import env from "./env";

let server: Server;

mongoUnit.start({ dbName: "gaia-project", version: "4.2.7" }).then(async () => {
  console.log("fake mongo is started: ", mongoUnit.getUrl());
  await initDb(mongoUnit.getUrl(), false);
  env.listen.port.api = 50606;
  env.silent = true;
  server = await listen();
  run();
});

after(() => {
  server.close();
  mongoose.connection.close();
  return mongoUnit.stop();
});
