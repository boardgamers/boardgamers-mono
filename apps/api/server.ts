import cluster from "node:cluster";
import { listen } from "./app/app.ts";
import initDb from "./app/config/db.ts";
import env from "./app/config/env.ts";
import { installProcessHandlers, logEvent } from "@bgs/utils/log";
import { listen as listenResources } from "./app/resources.ts";

installProcessHandlers("api");

const handleError = (err: Error) => {
  logEvent("error", "startup", { source: "api", error: err.message, stack: err.stack?.split("\n") });
  process.exit(1);
};

await initDb().catch(handleError);

// In production, run a process for each CPU
if (cluster.isPrimary && env.isProduction && Number(env.threads) > 1) {
  for (let i = 0; i < Number(env.threads); i++) {
    cluster.fork();
  }
  cluster.on("exit", (worker, code, signal) => {
    logEvent("warn", "workerExited", { source: "api", workerId: worker.id, code, signal });
    cluster.fork();
  });
} else {
  listen().catch(handleError);
  listenResources().catch(handleError);
  await import("./app/ws.ts");
}

if (cluster.isPrimary) {
  await import("./app/services/cron.ts");
}
