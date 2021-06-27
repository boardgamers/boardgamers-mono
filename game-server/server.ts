import cluster from "cluster";
import "dotenv/config";
import env from "./app/config/env";

// In production, run a process for each CPU
if (cluster.isMaster && env.isProduction && env.threads > 1) {
  for (let i = 0; i < env.threads; i++) {
    cluster.fork();
  }
} else {
  // tslint:disable-next-line no-var-requires
  require("./app/app");
}

if (cluster.isMaster) {
  require("./app/services/cron");
}
