import { listen } from "./app/app.ts";
import env from "./app/config/env.ts";
import { gracefulShutdown, installProcessHandlers, logEvent, pm2Ready, type Closable } from "@bgs/utils/log";
import type { Server } from "node:http";

installProcessHandlers("game-server");

const handleError = (err: Error) => {
	logEvent("error", "startup", { source: "game-server", error: err.message, stack: err.stack?.split("\n") });
	process.exit(1);
};

// Workers (PM2 cluster, cron=false) serve the gameplay API. The dedicated
// game-server-cron process (cron=true) runs start/drop/quit processing and engine
// installs and must NOT bind the port — it runs alongside a worker on the same host
// (PM2 fork), so listening would hit EADDRINUSE. In dev, cron defaults on and the
// single process does both (serve + cron). Preview envs run one process doing both
// in production mode, so they force serving with serve=true.
const serving = process.env.serve === "true" || !env.cron || !env.isProduction;

let server: Server | undefined;
let cron: Closable | undefined;

if (serving) {
	server = await listen().catch(handleError);
}

if (env.cron) {
	({ cron } = await import("./app/services/cron.ts"));
}

gracefulShutdown("game-server", () => [server, cron]);

pm2Ready();
