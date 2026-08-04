import { listen } from "./app/app.ts";
import env from "./app/config/env.ts";
import { installProcessHandlers, logEvent } from "@bgs/utils/log";

installProcessHandlers("game-server");

const handleError = (err: Error) => {
	logEvent("error", "startup", { source: "game-server", error: err.message, stack: err.stack?.split("\n") });
	process.exit(1);
};

// Workers (PM2 cluster, cron=false) serve the gameplay API. The dedicated
// game-server-cron process (cron=true) runs start/drop/quit processing and engine
// installs and must NOT bind the port — it runs alongside a worker on the same host
// (PM2 fork), so listening would hit EADDRINUSE. In dev, cron defaults on and the
// single process does both (serve + cron).
const serving = !env.cron || !env.isProduction;

if (serving) {
	listen().catch(handleError);
}

if (env.cron) {
	await import("./app/services/cron.ts");
}
