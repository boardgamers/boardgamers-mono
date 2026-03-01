import cluster from "cluster";
import env from "./app/config/env.ts";

async function main() {
  // In production, run a process for each CPU
  if (cluster.isMaster && env.isProduction && env.threads > 1) {
    for (let i = 0; i < env.threads; i++) {
      cluster.fork();
    }
  } else {
    await import("./app/app.ts");
  }

  if (cluster.isMaster) {
    await import("./app/services/cron.ts");
  }
}

void main();
