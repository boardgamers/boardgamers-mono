import env from "./app/config/env.ts";

async function main() {
  let isPrimary = true;
  const isMultiThread = env.isProduction && env.threads > 1;

  // Only import node:cluster when we actually need to fork workers.
  // The cluster module's IPC conflicts with `node --watch`, causing EPIPE.
  if (isMultiThread) {
    const cluster = await import("node:cluster");
    isPrimary = cluster.isPrimary;
    if (cluster.isPrimary) {
      for (let i = 0; i < env.threads; i++) {
        cluster.fork();
      }
    }
  }

  // Start the app unless we're the primary in multi-thread production mode
  if (!isMultiThread || !isPrimary) {
    await import("./app/app.ts");
  }

  if (isPrimary) {
    await import("./app/services/cron.ts");
  }
}

void main();
