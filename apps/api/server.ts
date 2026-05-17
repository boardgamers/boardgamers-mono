import cluster from "node:cluster";
import { listen } from "./app/app.ts";
import initDb from "./app/config/db.ts";
import env from "./app/config/env.ts";
import { listen as listenResources } from "./app/resources.ts";

const handleError = (err: Error) => {
  console.error(err);
  process.exit(1);
};

await initDb().catch(handleError);

// In production, run a process for each CPU
if (cluster.isPrimary && env.isProduction && Number(env.threads) > 1) {
  for (let i = 0; i < Number(env.threads); i++) {
    cluster.fork();
  }
} else {
  listen().catch(handleError);
  listenResources().catch(handleError);
  await import("./app/ws.ts");
}

if (cluster.isPrimary) {
  await import("./app/services/cron.ts");
}
