import cluster from "cluster";
import "dotenv/config";
import { listen } from "./app/app";
import initDb from "./app/config/db";
import env from "./app/config/env";
import { listen as listenResources } from "./app/resources";

const handleError = (err: Error) => {
  console.error(err);
  process.exit(1);
};

initDb().catch(handleError);

// In production, run a process for each CPU
if (cluster.isMaster && env.isProduction && env.threads > 1) {
  for (let i = 0; i < env.threads; i++) {
    cluster.fork();
  }
} else {
  listen().catch(handleError);
  listenResources().catch(handleError);
  // tslint:disable-next-line no-var-requires
  require("./app/ws");
}

if (cluster.isMaster) {
  require("./app/services/cron");
}
