// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { colls, db } from "../../config/db.ts";
import { migration } from "./1.13.0-beta-game-status.ts";

// Pre-beta fixtures: the lifecycle status as the pre-1.13.0 code produced it —
// requests flipped straight to "implemented" on the first version upload, even
// when nothing was public yet. Inserted through the untyped db handle where they
// model a state the current types no longer produce.
async function seed() {
	await db()
		.collection("gameinfos")
		.insertMany([
			// Beta: an implementation exists but no version is public.
			{ _id: { game: "outpost", version: 1 }, viewer: { url: "//v1" }, public: false },
			// Public game: one public version, plus a newer beta one.
			{ _id: { game: "container", version: 1 }, viewer: { url: "//v1" }, public: true },
			{ _id: { game: "container", version: 2 }, viewer: { url: "//v2" }, public: false },
			// Only-public-version-archived edge: nothing publicly listed → beta.
			{ _id: { game: "retired", version: 1 }, viewer: { url: "//v1" }, public: true, meta: { archived: true } },
			// A private implementation: beta-only but exempted from the requests page.
			{ _id: { game: "clash", version: 1 }, viewer: { url: "//v1" }, public: false },
		]);
	await db()
		.collection("gamemetadatas")
		.insertMany([
			// The pre-beta upsert stamped "implemented" on the ex-request.
			{ _id: "outpost", label: "Outpost", players: [2], status: "implemented", likeCount: 4 },
			{ _id: "container", label: "Container", players: [3] },
			{ _id: "retired", label: "Retired", players: [2] },
			{ _id: "clash", label: "Clash", players: [2] },
			// No version doc: a plain request, untouched by the migration.
			{ _id: "draftosaurus", label: "Draftosaurus", players: [], status: "requested", likeCount: 1 },
		]);
}

describe("migration 1.13.0 — beta game status", () => {
	after(() => db().dropDatabase());

	beforeEach(async () => {
		await colls.gameInfos.deleteMany({});
		await colls.gameMetadatas.deleteMany({});
	});

	it("stamps beta on versioned games without a public version, clears it on public games", async () => {
		await seed();

		await migration.up();

		const outpost = await colls.gameMetadatas.findOne({ _id: "outpost" });
		assert.strictEqual(outpost!.status, "beta");
		assert.strictEqual(outpost!.likeCount, 4, "votes are kept");

		const container = await colls.gameMetadatas.findOne({ _id: "container" });
		assert.strictEqual(container!.status, undefined, "a public non-archived version means implemented");

		const retired = await colls.gameMetadatas.findOne({ _id: "retired" });
		assert.strictEqual(retired!.status, "beta", "an archived public version is not a public release");

		const clash = await colls.gameMetadatas.findOne({ _id: "clash" });
		assert.strictEqual(clash!.status, "implemented", "private implementations are exempted from the requests page");

		const draftosaurus = await colls.gameMetadatas.findOne({ _id: "draftosaurus" });
		assert.strictEqual(draftosaurus!.status, "requested", "version-less requests are untouched");
	});

	it("is idempotent: a re-run re-stamps the same values", async () => {
		await seed();
		await migration.up();
		const first = await colls.gameMetadatas.find({}).toArray();

		await migration.up();

		const second = await colls.gameMetadatas.find({}).toArray();
		assert.deepStrictEqual(
			second.map((m) => [m._id, m.status]),
			first.map((m) => [m._id, m.status]),
		);
	});
});
