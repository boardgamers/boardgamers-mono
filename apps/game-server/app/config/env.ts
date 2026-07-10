import fs from "node:fs";
import os from "node:os";

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
    port: +process.env.port || 50803,
    // Bind explicitly to 127.0.0.1: see apps/api/app/config/env.ts for the full
    // rationale (localhost → ::1 bind vs 127.0.0.1 dial → ECONNREFUSED).
    host: process.env.listenHost ?? "127.0.0.1",
  },
  database: {
    bgs: {
      url: process.env.dbUrl || "mongodb://localhost:27017/admin",
      name: dbName,
    },
  },
  isProduction: process.env.NODE_ENV === "production",
  threads: +(process.env.threads || os.cpus().length),
  seedEncryptionKey: process.env.seedEncryptionKey || "hashing key for seed",
  cron: process.env.cron || process.env.chron || false,
};
