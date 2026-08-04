import fs from "node:fs";
import { parseEnv } from "node:util";

// Load .env files before reading process.env (see api/app/config/env.ts for why this
// lives here and not in the entrypoint: ESM import hoisting + PM2 cluster dropping
// node_args). Real environment variables take precedence over file values.
for (const name of [".env", `.env.${process.env.NODE_ENV ?? "development"}`]) {
	const url = new URL(`../../${name}`, import.meta.url);
	if (fs.existsSync(url)) {
		for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(url, "utf8")))) {
			process.env[key] ??= value;
		}
	}
}

let dbName = process.env.dbName ?? "bgs";

if (process.env.NODE_ENV === "test") {
	dbName += "-test";
} else if (process.env.NODE_ENV !== "production") {
	dbName += "-dev";
}

export default {
	jwt: {
		keys: {
			// PRIVATE KEY NOT NEEDED! We don't sign jwt tokens here.
			public:
				process.env.jwtMode === "asymmetric"
					? fs.readFileSync(new URL("public.pem", import.meta.url))
					: process.env.jwtSecret || "Secret du token JSON...",
		},
		// algorithm: process.env.jwtMode === "asymmetric" ? "RS256" : "HS256" as "RS256" | "HS256"
	},
	listen: {
		port: Number(process.env.port) || 50803,
		// Bind explicitly to 127.0.0.1: see apps/api/app/config/env.ts for the full
		// rationale (localhost → ::1 bind vs 127.0.0.1 dial → ECONNREFUSED).
		host: process.env.listenHost ?? "127.0.0.1",
	},
	database: {
		bgs: {
			url: process.env.dbUrl || "mongodb://localhost:27517/admin",
			name: dbName,
		},
	},
	isProduction: process.env.NODE_ENV === "production",
	seedEncryptionKey: process.env.seedEncryptionKey || "hashing key for seed",
	// Cron (start/drop/quit games, engine install) is on by default — in dev the single
	// process must run it. PM2 workers opt out with cron=false so only the dedicated
	// game-server-cron process runs it (see ecosystem.config.cjs).
	cron: (process.env.cron ?? "true") !== "false",
};
