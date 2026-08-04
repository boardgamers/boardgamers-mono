// Load env files in-process. PM2 cluster mode does NOT propagate `node_args`
// (--env-file) to forked workers, so passing --env-file via the ecosystem config
// silently loses env vars (dbUrl, …) and the app falls back to defaults. Loading
// here is independent of how the process was spawned. loadEnvFile is a no-op when
// the file is absent, and PM2's own `env` block overrides these via real env vars.
import { loadEnvFile } from "node:process";
loadEnvFile(".env");
loadEnvFile(".env.production");

import { listen } from "./app/app.ts";
import initDb from "./app/config/db.ts";
import env from "./app/config/env.ts";
import { gracefulShutdown, installProcessHandlers, logEvent, pm2Ready, type Closable } from "@bgs/utils/log";
import { listen as listenResources } from "./app/resources.ts";
import type { Server } from "node:http";
import type { WebSocketServer } from "ws";

installProcessHandlers("api");

const handleError = (err: Error) => {
	logEvent("error", "startup", { source: "api", error: err.message, stack: err.stack?.split("\n") });
	process.exit(1);
};

await initDb().catch(handleError);

// Workers (cron=false) serve traffic. The dedicated api-cron process (cron=true) only
// runs cron and must NOT bind the ports — it runs alongside a worker on the same host
// (PM2 fork), so listening would hit EADDRINUSE. In dev, cron defaults on and the single
// process does both (serve + cron).
const serving = !env.cron || !env.isProduction;

let apiServer: Server | undefined;
let resourcesServer: Server | undefined;
let wss: WebSocketServer | undefined;
let cron: Closable | undefined;

if (serving) {
	apiServer = await listen().catch(handleError);
	resourcesServer = await listenResources().catch(handleError);
	({ wss } = await import("./app/ws.ts"));
}

// Cron (game notifications, scheduled games, emails) runs when env.cron is set —
// always in dev (single process), and only in the dedicated api-cron PM2 process in
// production. See ecosystem.config.cjs.
if (env.cron) {
	({ cron } = await import("./app/services/cron.ts"));
}

gracefulShutdown("api", () => [apiServer, resourcesServer, wss, cron]);

// Signal PM2 (wait_ready) that we're up and listening — reload only swaps in a new
// worker once it reports ready, so a worker still connecting to the DB gets no traffic.
pm2Ready();
