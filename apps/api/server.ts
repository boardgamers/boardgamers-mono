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

// Workers (cron=false) serve traffic. The dedicated api-cron process (cron=true) only
// runs cron and must NOT bind the ports — it runs alongside a worker on the same host
// (PM2 fork), so listening would hit EADDRINUSE. In dev, cron defaults on and the single
// process does both (serve + cron).
const serving = !env.cron || !env.isProduction;

if (serving) {
	listen().catch(handleError);
	listenResources().catch(handleError);
	await import("./app/ws.ts");
}

// Cron (game notifications, scheduled games, emails) runs when env.cron is set —
// always in dev (single process), and only in the dedicated api-cron PM2 process in
// production. See ecosystem.config.cjs.
if (env.cron) {
	await import("./app/services/cron.ts");
}
