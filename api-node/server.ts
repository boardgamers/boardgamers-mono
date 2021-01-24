import "dotenv/config";
import initDb from "./app/config/db";
import cluster from "cluster";

import env from "./app/config/env";
import { listen } from "./app/app";
import { listen as listenResources } from "./app/resources";

initDb();

// In production, run a process for each CPU
if (cluster.isMaster && env.isProduction) {
  for (let i = 0; i < env.threads; i++) {
    cluster.fork();
  }
} else {
  listen();
  listenResources();
  // tslint:disable-next-line no-var-requires
  require("./app/ws");
}

if (cluster.isMaster) {
  require("./app/services/cron");
}
