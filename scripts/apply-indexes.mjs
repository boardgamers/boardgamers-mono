// Applies @bgs/models' ensureIndexes (or reports its plan) against a MongoDB.
//
// Usage: node scripts/apply-indexes.mjs [plan]
//   (default)  apply: reconcile the live indexes with the declared set
//   plan       dry-run: print the actions ensureIndexes WOULD take and exit
//              non-zero if any index would be dropped or rebuilt — i.e. the
//              checked-out index definitions don't match what's already in the
//              database. Used by the index-drift CI guard.
//
// Env: dbUrl (default mongodb://localhost:27017/admin), dbName (default
// bgs-index-drift). Passed explicitly — this script must work in a bare CI
// runner without any of the apps' .env files.
// Resolve through packages/models directly: this script must run in CI with a
// filtered install (`pnpm install --filter @bgs/models...`), where the
// workspace root has no dependency on @bgs/models or mongodb.
import { createRequire } from "node:module";
import { ensureIndexes } from "../packages/models/setup.ts";

const modelsRequire = createRequire(new URL("../packages/models/package.json", import.meta.url));
const { MongoClient } = modelsRequire("mongodb");

// planIndexChanges is introduced by the change that adds this script; the base
// branch's setup.ts doesn't have it. Fall back to the dryRun option so the
// workflow can apply the base's indexes with its own code.
const planIndexChanges = async (db) => ensureIndexes(db, { dryRun: true });

const dbUrl = process.env.dbUrl ?? "mongodb://localhost:27017/admin";
const dbName = process.env.dbName ?? "bgs-index-drift";
const planOnly = process.argv[2] === "plan";

const client = new MongoClient(dbUrl);
try {
	await client.connect();
	const db = client.db(dbName);
	const actions = (await (planOnly ? planIndexChanges(db) : ensureIndexes(db))) ?? [];
	console.log(JSON.stringify(actions, null, 2));
	if (!planOnly) {
		console.log(`Applied indexes: ${actions.length} change(s).`);
	}
	if (planOnly) {
		const destructive = actions.filter((a) => a.type === "drop" || a.type === "rebuild");
		if (destructive.length > 0) {
			console.error(
				`\nIndex drift: applying this PR's index definitions on top of the base branch's ` +
					`database would drop/rebuild ${destructive.length} index(es):\n` +
					destructive
						.map((a) =>
							a.type === "rebuild"
								? `  - rebuild ${a.collection}.${a.name} (${a.reason})`
								: `  - drop ${a.collection}.${a.name}`,
						)
						.join("\n") +
					`\n\nThis is the shape change that crash-loops production on deploy. ` +
					`If the drop/rebuild is intended, remove the old index from the declared ` +
					`indexes and add its name to droppedIndexes in packages/models/setup.ts instead.`,
			);
			process.exit(1);
		}
		console.log(`No destructive index changes (${actions.length} create(s) pending).`);
	}
} finally {
	await client.close();
}
