import fs from "fs";
import os from "os";
import path from "path";

let dbName = process.env.dbName ?? "bgs";

if (process.env.NODE_ENV === "test") {
  dbName += "-test";
} else if (process.env.NODE_ENV !== "production") {
  dbName += "-dev";
}

export default {
  jwt: {
    keys: {
      // PRIVATE KEY NOT NEEDED! We don't sign jwt tokens here
      // private: process.env.jwtMode === "asymmetric" ? fs.readFileSync(path.join(__dirname, 'private.key')) : (process.env.jwtSecret || "Secret du token JSON..."),
      public:
        process.env.jwtMode === "asymmetric"
          ? fs.readFileSync(path.join(__dirname, "public.pem"))
          : process.env.jwtSecret || "Secret du token JSON...",
    },
    // algorithm: process.env.jwtMode === "asymmetric" ? "RS256" : "HS256" as "RS256" | "HS256"
  },
  listen: {
    port: +process.env.port || 50803,
    host: process.env.listenHost ?? "localhost",
  },
  database: {
    bgs: {
      url: process.env.dbUrl || "mongodb://localhost:27017/admin",
      name: dbName,
    },
  },
  isProduction: process.env.NODE_ENV === "production",
  threads: isNaN(parseInt(process.env.threads)) ? os.cpus().length : parseInt(process.env.threads),
  seedEncryptionKey: process.env.seedEncryptionKey || "hashing key for seed",
  cron: process.env.cron || process.env.chron || false,
};
