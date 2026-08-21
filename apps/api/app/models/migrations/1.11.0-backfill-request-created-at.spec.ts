// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import { migration } from "./1.11.0-backfill-request-created-at.ts";

// Pre-#382 fixtures: request docs without `createdAt`. Inserted through the
// untyped db handle where they model a state the current types no longer produce.
async function seed() {
	const older = new ObjectId("5b5760eede434e317c735d03");
	const newer = new ObjectId();
	const stamped = new Date("2024-05-01T12:00:00Z");
	await db()
		.collection("feedbackrequests")
		.insertMany([
			{ _id: older, kind: "site", title: "Old site request", likeCount: 3 },
			{ _id: newer, kind: "game", game: "somegame", title: "New game request", likeCount: 1 },
			{ _id: new ObjectId(), kind: "site", title: "Already stamped", likeCount: 0, createdAt: stamped },
		]);
	await db()
		.collection("gamemetadatas")
		.insertMany([
			{ _id: "requested-one", label: "Requested One", players: [], status: "requested", likeCount: 2 },
			{ _id: "requested-two", label: "Requested Two", players: [], status: "requested", likeCount: 0 },
			{
				_id: "requested-stamped",
				label: "Requested Stamped",
				players: [],
				status: "requested",
				likeCount: 1,
				createdAt: stamped,
			},
			// Implemented games are not requests and must stay untouched.
			{ _id: "implemented", label: "Implemented", players: [2] },
		]);
	return { older, newer, stamped };
}

describe("migration 1.11.0 — backfill createdAt on feedback & game requests", () => {
	after(() => db().dropDatabase());

	beforeEach(async () => {
		await colls.feedbackRequests.deleteMany({});
		await colls.gameMetadatas.deleteMany({});
	});

	it("backfills feedback requests from the _id timestamp", async () => {
		const { older, newer, stamped } = await seed();

		await migration.up();

		const old = await colls.feedbackRequests.findOne({ _id: older });
		assert.deepStrictEqual(old!.createdAt, older.getTimestamp());
		const recent = await colls.feedbackRequests.findOne({ _id: newer });
		assert.deepStrictEqual(recent!.createdAt, newer.getTimestamp());
		const already = await colls.feedbackRequests.findOne({ title: "Already stamped" });
		assert.deepStrictEqual(already!.createdAt, stamped, "existing createdAt untouched");
	});

	it("stamps requested games (slug ids have no embedded timestamp) and skips implemented games", async () => {
		const { stamped } = await seed();
		const before = Date.now();

		await migration.up();

		const one = await colls.gameMetadatas.findOne({ _id: "requested-one" });
		assert.ok(one!.createdAt instanceof Date);
		assert.ok(one!.createdAt.getTime() >= before && one!.createdAt.getTime() <= Date.now());
		const two = await colls.gameMetadatas.findOne({ _id: "requested-two" });
		assert.ok(two!.createdAt instanceof Date);
		const already = await colls.gameMetadatas.findOne({ _id: "requested-stamped" });
		assert.deepStrictEqual(already!.createdAt, stamped, "existing createdAt untouched");
		const implemented = await colls.gameMetadatas.findOne({ _id: "implemented" });
		assert.strictEqual(implemented!.createdAt, undefined, "implemented games are not requests");
	});

	it("is idempotent: a re-run is a no-op", async () => {
		const { older } = await seed();
		await migration.up();

		const first = await colls.gameMetadatas.findOne({ _id: "requested-one" });
		await migration.up();

		const old = await colls.feedbackRequests.findOne({ _id: older });
		assert.deepStrictEqual(old!.createdAt, older.getTimestamp());
		const second = await colls.gameMetadatas.findOne({ _id: "requested-one" });
		assert.deepStrictEqual(second!.createdAt, first!.createdAt, "re-run does not re-stamp");
	});
});
