import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MongoClient, type Db } from "mongodb";
import { JWT_REFRESH_TOKENS_COLLECTION } from "./jwtrefreshtoken.ts";
import { API_ERRORS_COLLECTION, apiErrorsCollectionOptions } from "./api-error.ts";
import { ensureCollections, ensureIndexes, planIndexChanges, reconcileIndexes, type IndexAction } from "./setup.ts";

assert.strictEqual(process.env.NODE_ENV, "test");

const dbUrl = process.env.dbUrl ?? "mongodb://localhost:27517/admin";
const dbName = `${process.env.dbName ?? "bgs"}-test`;

let client: MongoClient;
let db: Db;

function actionSummaries(actions: IndexAction[]): string[] {
	return actions.map((a) => `${a.type}:${a.collection}.${a.name}`);
}

before(async () => {
	client = new MongoClient(dbUrl);
	await client.connect();
	db = client.db(dbName);
	// Safety: never run this suite against a db that looks real.
	assert.ok(dbName.endsWith("-test"));
	const users = await db.listCollections({ name: "users" }).toArray();
	if (users.length > 0) {
		assert.ok((await db.collection("users").countDocuments()) < 10, "This doesn't seem to be a test database");
	}
});

after(async () => {
	await db.dropDatabase();
	await client.close();
});

describe("reconcileIndexes", () => {
	beforeEach(async () => {
		await db
			.collection("reconcile-test")
			.drop()
			.catch(() => {});
	});

	it("creates declared indexes on a fresh (non-existing) collection", async () => {
		const collection = db.collection("reconcile-test");
		const actions = await reconcileIndexes(collection, [{ key: { a: 1 } }, { key: { b: 1 }, unique: true }]);

		assert.deepEqual(actionSummaries(actions), ["create:reconcile-test.a_1", "create:reconcile-test.b_1"]);
		const indexes = await collection.indexes();
		const byName = new Map(indexes.map((i) => [i.name, i]));
		assert.ok(byName.has("a_1"));
		assert.strictEqual(byName.get("b_1")?.unique, true);
	});

	it("is a no-op when the live indexes already match the declared set", async () => {
		const collection = db.collection("reconcile-test");
		await reconcileIndexes(collection, [{ key: { a: 1 } }, { key: { b: 1 }, unique: true }]);

		const actions = await reconcileIndexes(collection, [{ key: { a: 1 } }, { key: { b: 1 }, unique: true }]);
		assert.deepEqual(actions, []);
	});

	it("drops and recreates an index whose options changed, ending in the new shape", async () => {
		const collection = db.collection("reconcile-test");
		await collection.createIndex({ code: 1 }, { sparse: true });

		const actions = await reconcileIndexes(collection, [{ key: { code: 1 } }]);

		assert.deepEqual(actionSummaries(actions), ["rebuild:reconcile-test.code_1"]);
		const rebuild = actions[0];
		assert.equal(rebuild.type, "rebuild");
		if (rebuild.type === "rebuild") {
			assert.match(rebuild.reason, /sparse/);
			assert.deepEqual(rebuild.oldOptions, { key: { code: 1 }, sparse: true });
			assert.deepEqual(rebuild.newOptions, { key: { code: 1 } });
		}
		const indexes = await collection.indexes();
		const code1 = indexes.find((i) => i.name === "code_1");
		assert.ok(code1);
		assert.strictEqual(code1.sparse, undefined);

		// And a second run is a no-op.
		assert.deepEqual(await reconcileIndexes(collection, [{ key: { code: 1 } }]), []);
	});

	it("detects a key-pattern change on an explicitly named index", async () => {
		const collection = db.collection("reconcile-test");
		await collection.createIndex({ a: 1 }, { name: "by_a" });

		const actions = await reconcileIndexes(collection, [{ key: { a: -1 }, name: "by_a" }]);
		assert.deepEqual(actionSummaries(actions), ["rebuild:reconcile-test.by_a"]);
		const [index] = (await collection.indexes()).filter((i) => i.name === "by_a");
		assert.deepEqual(index.key, { a: -1 });
	});

	it("derives default index names the way Mongo does (a_-1, t_text, ...)", async () => {
		const collection = db.collection("reconcile-test");
		const actions = await reconcileIndexes(collection, [{ key: { a: -1 } }, { key: { t: "text" } }]);
		assert.deepEqual(actionSummaries(actions), ["create:reconcile-test.a_-1", "create:reconcile-test.t_text"]);
		assert.deepEqual(await reconcileIndexes(collection, [{ key: { a: -1 } }, { key: { t: "text" } }]), []);
	});

	// --- Regression: the four latent non-convergence bugs (each used to spin then
	// throw at the convergence check → the exact PM2 crash-loop this fixes). ---

	it("converges on a declared collation (server back-fills + stamps a version)", async () => {
		const collection = db.collection("reconcile-test");
		const declared = [{ key: { name: 1 }, collation: { locale: "en", strength: 2 } }];
		await reconcileIndexes(collection, declared);
		// The live collation doc has every default + a server version; a second run
		// must be a no-op, not a perpetual rebuild.
		assert.deepEqual(await reconcileIndexes(collection, declared), []);
		const live = (await collection.indexes()).find((i) => i.name === "name_1");
		assert.strictEqual(live?.collation?.locale, "en");
		assert.strictEqual(live?.collation?.strength, 2);
	});

	it("converges on a 2dsphere index (server stamps 2dsphereIndexVersion)", async () => {
		const collection = db.collection("reconcile-test");
		const declared = [{ key: { loc: "2dsphere" as const } }];
		await reconcileIndexes(collection, declared);
		// The server stores 2dsphereIndexVersion: 4 which no declared spec carries;
		// a second run must be a no-op, not a perpetual rebuild.
		assert.deepEqual(await reconcileIndexes(collection, declared), []);
		const live = (await collection.indexes()).find((i) => i.name === "loc_2dsphere");
		assert.ok(live);
		// The exact version is server-dependent (4 on mongo 8.x) — assert it's set,
		// not a specific number, so the spec passes across server versions.
		assert.strictEqual(typeof live["2dsphereIndexVersion"], "number");
	});

	it("converges on a text index with PARTIAL declared weights", async () => {
		const collection = db.collection("reconcile-test");
		const declared = [{ key: { a: "text" as const, b: "text" as const }, weights: { a: 10 } }];
		await reconcileIndexes(collection, declared);
		// Stored as the complete {a:10, b:1}; a second run must not rebuild.
		assert.deepEqual(await reconcileIndexes(collection, declared), []);
		const live = (await collection.indexes()).find((i) => i.name === "a_text_b_text");
		assert.deepEqual(live?.weights, { a: 10, b: 1 });
	});

	it("converges on Map keys (default name derivation is Map-safe)", async () => {
		const collection = db.collection("reconcile-test");
		const declared = [{ key: new Map<string, 1>([["m", 1]]) }];
		const actions = await reconcileIndexes(collection, declared);
		assert.deepEqual(actionSummaries(actions), ["create:reconcile-test.m_1"]);
		assert.deepEqual(await reconcileIndexes(collection, declared), []);
	});

	it("heals a same-key index under a different (stale) name instead of crash-looping", async () => {
		const collection = db.collection("reconcile-test");
		// Live db has the key under the old default name...
		await collection.createIndex({ a: 1 });
		// ...but the code now declares the same key with an explicit name.
		const actions = await reconcileIndexes(collection, [{ key: { a: 1 }, name: "by_a" }]);
		assert.ok(actionSummaries(actions).includes("drop:reconcile-test.a_1"));
		assert.ok(actionSummaries(actions).includes("create:reconcile-test.by_a"));
		const names = (await collection.indexes()).map((i) => i.name ?? "").toSorted((a, b) => a.localeCompare(b));
		assert.deepEqual(names, ["_id_", "by_a"]);
		// And it converges: a second run is a no-op.
		assert.deepEqual(await reconcileIndexes(collection, [{ key: { a: 1 }, name: "by_a" }]), []);
	});

	it("treats compound key ORDER as significant ({a,b} ≠ {b,a})", async () => {
		const collection = db.collection("reconcile-test");
		await collection.createIndex({ a: 1, b: 1 });
		// Same fields, different order → different index → must rebuild, not no-op.
		const actions = await reconcileIndexes(collection, [{ key: { b: 1, a: 1 } }]);
		assert.deepEqual(actionSummaries(actions), ["create:reconcile-test.b_1_a_1"]);
	});

	it("drops an index listed in drops", async () => {
		const collection = db.collection("reconcile-test");
		await collection.createIndex({ legacy: 1 });

		const actions = await reconcileIndexes(collection, [], ["legacy_1"]);

		assert.deepEqual(actionSummaries(actions), ["drop:reconcile-test.legacy_1"]);
		assert.ok(actions[0].type === "drop" && actions[0].declared);
		assert.ok(!(await collection.indexes()).some((i) => i.name === "legacy_1"));
	});

	it("tolerates dropping an index that is already gone (code 27 race)", async () => {
		const collection = db.collection("reconcile-test");
		await collection.insertOne({ seeded: true }); // materialize the collection

		const actions = await reconcileIndexes(collection, [], ["missing_1"]);
		assert.deepEqual(actions, []);
	});

	it("dry-run reports actions without applying them", async () => {
		const collection = db.collection("reconcile-test");
		await collection.createIndex({ code: 1 }, { sparse: true });

		const actions = await reconcileIndexes(collection, [{ key: { code: 1 } }, { key: { fresh: 1 } }], ["missing_1"], {
			dryRun: true,
		});

		assert.deepEqual(actionSummaries(actions), ["rebuild:reconcile-test.code_1", "create:reconcile-test.fresh_1"]);
		// Nothing changed in the db.
		const indexes = await collection.indexes();
		assert.strictEqual(indexes.find((i) => i.name === "code_1")?.sparse, true);
		assert.ok(!indexes.some((i) => i.name === "fresh_1"));
	});
});

describe("ensureIndexes", () => {
	it("creates every declared index on a fresh database", async () => {
		await db.dropDatabase();
		const actions = await ensureIndexes(db);
		assert.ok(actions.some((a) => a.type === "create" && a.collection === "users"));
		assert.ok(actions.some((a) => a.type === "create" && a.collection === JWT_REFRESH_TOKENS_COLLECTION));
		assert.ok(!actions.some((a) => a.type === "rebuild" || a.type === "drop"));
	});

	it("is a no-op on a second run", async () => {
		const actions = await ensureIndexes(db);
		assert.deepEqual(actions, []);
	});

	it("drops the legacy jwtrefreshtokens.code_1 index", async () => {
		await db.collection(JWT_REFRESH_TOKENS_COLLECTION).createIndex({ code: 1 }, { name: "code_1", sparse: true });

		const actions = await ensureIndexes(db);

		assert.deepEqual(actionSummaries(actions.filter((a) => a.name === "code_1")), [
			`drop:${JWT_REFRESH_TOKENS_COLLECTION}.code_1`,
		]);
		assert.ok(!(await db.collection(JWT_REFRESH_TOKENS_COLLECTION).indexes()).some((i) => i.name === "code_1"));
	});

	it("self-heals a drifted index instead of throwing IndexKeySpecsConflict", async () => {
		// Simulate the prod crash scenario: the live db has createdAt_1 without the
		// TTL option, the code declares expireAfterSeconds.
		const collection = db.collection(JWT_REFRESH_TOKENS_COLLECTION);
		await collection.dropIndex("createdAt_1");
		await collection.createIndex({ createdAt: 1 });

		const actions = await ensureIndexes(db);

		assert.deepEqual(actionSummaries(actions.filter((a) => a.name === "createdAt_1")), [
			`rebuild:${JWT_REFRESH_TOKENS_COLLECTION}.createdAt_1`,
		]);
		const index = (await collection.indexes()).find((i) => i.name === "createdAt_1");
		assert.strictEqual(index?.expireAfterSeconds, 120 * 24 * 3600);

		// Boot is idempotent again afterwards.
		assert.deepEqual(await ensureIndexes(db), []);
	});
});

describe("ensureCollections", () => {
	const cappedOptions = async () =>
		(await db.listCollections({ name: API_ERRORS_COLLECTION }, { nameOnly: false }).toArray())[0]?.options;

	it("creates the capped apierrors collection on a fresh database", async () => {
		await db.dropDatabase();
		await ensureCollections(db);
		const options = await cappedOptions();
		assert.equal(options?.capped, true);
		assert.equal(options?.size, apiErrorsCollectionOptions.size);
		assert.equal(options?.max, apiErrorsCollectionOptions.max);
	});

	it("is a no-op when the live capped options already match", async () => {
		await ensureCollections(db);
		await db
			.collection(API_ERRORS_COLLECTION)
			.insertOne({ error: { name: "E", message: "m", stack: [] }, request: { url: "/", method: "GET", body: "" } });
		await ensureCollections(db);
		assert.equal(await db.collection(API_ERRORS_COLLECTION).countDocuments(), 1, "collection must not be recreated");
	});

	it("recreates the collection when the declared size/max diverge", async () => {
		await db.dropDatabase();
		// The pre-100k shape.
		await db.createCollection(API_ERRORS_COLLECTION, { capped: true, size: 10 * 1000 * 1000, max: 10000 });
		await db
			.collection(API_ERRORS_COLLECTION)
			.insertOne({ error: { name: "E", message: "m", stack: [] }, request: { url: "/", method: "GET", body: "" } });

		await ensureCollections(db);

		const options = await cappedOptions();
		assert.equal(options?.size, apiErrorsCollectionOptions.size);
		assert.equal(options?.max, apiErrorsCollectionOptions.max);
		assert.equal(await db.collection(API_ERRORS_COLLECTION).countDocuments(), 0, "old entries are dropped");

		// Idempotent: a second run leaves the recreated collection alone.
		await db
			.collection(API_ERRORS_COLLECTION)
			.insertOne({ error: { name: "E", message: "m", stack: [] }, request: { url: "/", method: "GET", body: "" } });
		await ensureCollections(db);
		assert.equal(await db.collection(API_ERRORS_COLLECTION).countDocuments(), 1);
	});

	it("tolerates a concurrent recreate (NamespaceExists from a sibling process)", async () => {
		await db.dropDatabase();
		await db.createCollection(API_ERRORS_COLLECTION, { capped: true, size: 10 * 1000 * 1000, max: 10000 });
		// Two boots racing the same recreate: both see the old options, both drop,
		// both create — the loser must no-op, not crash.
		await Promise.all([ensureCollections(db), ensureCollections(db)]);
		const options = await cappedOptions();
		assert.equal(options?.size, apiErrorsCollectionOptions.size);
		assert.equal(options?.max, apiErrorsCollectionOptions.max);
	});
});

describe("planIndexChanges", () => {
	it("reports nothing when the db matches the declared set", async () => {
		await db.dropDatabase();
		await ensureIndexes(db);
		assert.deepEqual(await planIndexChanges(db), []);
	});

	it("reports a rebuild for a drifted index without applying it", async () => {
		const collection = db.collection(JWT_REFRESH_TOKENS_COLLECTION);
		await collection.dropIndex("createdAt_1");
		await collection.createIndex({ createdAt: 1 });

		const actions = await planIndexChanges(db);
		assert.deepEqual(actionSummaries(actions), [`rebuild:${JWT_REFRESH_TOKENS_COLLECTION}.createdAt_1`]);
		// Untouched.
		assert.strictEqual(
			(await collection.indexes()).find((i) => i.name === "createdAt_1")?.expireAfterSeconds,
			undefined,
		);
	});
});
