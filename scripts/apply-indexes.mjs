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
import * as setup from "../packages/models/setup.ts";

const modelsRequire = createRequire(new URL("../packages/models/package.json", import.meta.url));
const { MongoClient } = modelsRequire("mongodb");

const { ensureIndexes } = setup;
// planIndexChanges / declaredIndexes / droppedIndexes are introduced by the
// change that adds this script; the base branch's setup.ts doesn't have them.
// Fall back to the dryRun option so the workflow can apply the base's indexes
// with its own code.
const planIndexChanges = setup.planIndexChanges ?? ((db) => ensureIndexes(db, { dryRun: true }));
const declaredIndexList = setup.declaredIndexes ?? [];
const droppedIndexList = setup.droppedIndexes ?? [];

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
		const drops = actions.filter((a) => a.type === "drop");
		const declaredDrops = drops.filter((a) => a.declared);
		const droppedNames = new Set(declaredDrops.map((a) => `${a.collection}.${a.name}`));
		const creates = actions.filter((a) => a.type === "create");

		// A drop must never ship in the same PR as the code that uses the index:
		// deploys ship code before migrations run, and a same-PR drop can race the
		// new index build / sibling PM2 processes. Detect a name that is in BOTH the
		// PR's declared index set AND its droppedIndexes — that PR removes an index
		// it still relies on, so the removal must be a separate follow-up PR.
		// See AGENTS.md "Removing an index". (Checked structurally from the declared
		// sets, independent of the live db state.)
		const declaredNames = new Map();
		for (const [collection, specs] of declaredIndexList) {
			for (const spec of specs) {
				const name =
					spec.name ??
					Object.entries(spec.key)
						.map(([f, d]) => `${f}_${String(d)}`)
						.join("_");
				declaredNames.set(`${collection}.${name}`, { collection, name });
			}
		}
		const selfConflicting = [];
		for (const [collection, names] of droppedIndexList) {
			for (const name of names) {
				if (declaredNames.has(`${collection}.${name}`)) {
					selfConflicting.push(`${collection}.${name}`);
				}
			}
		}
		if (selfConflicting.length > 0) {
			console.error(
				`\nIndex drop sequencing violation: this PR declares a drop for an index it also declares:\n` +
					selfConflicting.map((n) => `  - ${n}`).join("\n") +
					`\n\nRemove the index from the declared set and ship that first; declare the drop in a ` +
					`SEPARATE follow-up PR (see AGENTS.md "Removing an index").`,
			);
			process.exit(1);
		}

		// Declared drops (droppedIndexes in setup.ts) are the sanctioned way to
		// remove an index — the case this guard exists to allow (#191). Undeclared
		// drops and rebuilds are the destructive, crash-loop-prone ones. A rebuild
		// of a name that's also being declared-dropped is just the drop winning the
		// race, not real drift — exclude it.
		const destructive = actions.filter(
			(a) =>
				(a.type === "rebuild" && !droppedNames.has(`${a.collection}.${a.name}`)) ||
				(a.type === "drop" && !a.declared),
		);
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
		console.log(
			`No destructive index changes (${creates.length} create(s), ` +
				`${declaredDrops.length} declared drop(s) pending).`,
		);
	}
} finally {
	await client.close();
}
