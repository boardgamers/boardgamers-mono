import os from "os";
import fs from "fs";
import path from "path";

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
  dbUrl: process.env.dbUrl || "mongodb://localhost:27017/admin",
  isProduction: process.env.NODE_ENV === "production",
  threads: process.env.threads || os.cpus().length,
  seedEncryptionKey: process.env.seedEncryptionKey || "hashing key for seed",
  chron: process.env.chron || false,
};
