import cluster from "node:cluster";
import env from "./app/config/env.ts";
import { installProcessHandlers, logEvent } from "@bgs/utils/log";

installProcessHandlers("game-server");

async function main() {
  // In production, run a process for each CPU
  if (cluster.isPrimary && env.isProduction && env.threads > 1) {
    for (let i = 0; i < env.threads; i++) {
      cluster.fork();
    }
    cluster.on("exit", (worker, code, signal) => {
      logEvent("warn", "workerExited", { source: "game-server", workerId: worker.id, code, signal });
      cluster.fork();
    });
  } else {
    await import("./app/app.ts");
  }

  if (cluster.isPrimary) {
    await import("./app/services/cron.ts");
  }
}

void main();
