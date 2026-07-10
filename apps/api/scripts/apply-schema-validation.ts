// Run this script after deploy to apply Zod-based $jsonSchema validators to prod DB.
// Validation is set to "warn" — it will log violations, not reject them.
//
// Usage:
//   NODE_ENV=production  npx tsx apps/api/scripts/apply-schema-validation.ts
//   NODE_ENV=development npx tsx apps/api/scripts/apply-schema-validation.ts   ← targets bgs-dev
//
// On prod you'll also need the env var: dbUrl=mongodb://...

import env from "../app/config/env.ts";
import initDb, { closeDb, db } from "../app/config/db.ts";
import { ensureValidation } from "@bgs/models";

env.script = true;
env.silent = false;

console.log(`Connecting to DB "${env.database.bgs.name}" on ${env.database.bgs.url}…`);

await initDb(env.database.bgs.url, /* runMigrations */ false);

console.log("Applying schema validators (warn mode)…");
await ensureValidation(db());

console.log("Done. Check MongoDB logs for `validate` entries on existing documents.");
await closeDb();
process.exit(0);
