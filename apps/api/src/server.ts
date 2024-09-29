import cluster from "cluster";
import { listen } from "./app";
import env from "./config/env";
import { listen as listenResources } from "./resources";

const handleError = (err: Error) => {
  console.error(err);
  process.exit(1);
};

// In production, run a process for each CPU
if (cluster.isPrimary && env.isProduction && env.threads > 1) {
  for (let i = 0; i < env.threads; i++) {
    cluster.fork();
  }
} else {
  listen().catch(handleError);
  listenResources().catch(handleError);
  require("./app/ws");
}

if (cluster.isPrimary) {
  require("./app/services/cron");
}
