// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { colls, db } from "../../config/db.ts";
import { migration } from "./1.10.0-credits-to-game-metadata.ts";

// Pre-#351 fixtures: credits live in `pages` docs named `<game>:credits`. Inserted
// through the untyped db handle where they model a state the current types no
// longer produce (a metadata doc without the field is still valid, so colls work
// for those).
function seedPreMove() {
	return Promise.all([
		db()
			.collection("pages")
			.insertMany([
				{
					_id: { name: "gaia-project:credits", lang: "en" },
					title: "Credits",
					content: "- Engine by [@someone](/user/someone)",
				},
				{ _id: { name: "gaia-project:credits", lang: "fr" }, title: "Crédits", content: "- Moteur par quelqu'un" },
				{ _id: { name: "empty:credits", lang: "en" }, title: "Credits", content: "" },
				{ _id: { name: "credits", lang: "en" }, title: "Credits", content: "Site-wide credits page — NOT per-game" },
			]),
		db()
			.collection("gamemetadatas")
			.insertMany([
				{ _id: "gaia-project", label: "Gaia Project", players: [1, 2, 3, 4] },
				{ _id: "empty", label: "Empty", players: [2] },
				// Already has credits (admin edited post-#351): the page must not clobber it.
				{ _id: "edited", label: "Edited", players: [2], credits: "edited credits" },
			]),
		db()
			.collection("pages")
			.insertOne({ _id: { name: "edited:credits", lang: "en" }, title: "Credits", content: "stale page credits" }),
	]);
}

describe("migration 1.10.0 — move per-game credits pages onto game metadata", () => {
	after(() => db().dropDatabase());

	beforeEach(async () => {
		await colls.pages.deleteMany({});
		await colls.gameMetadatas.deleteMany({});
	});

	it("moves each en <game>:credits page onto its game metadata and deletes the page", async () => {
		await seedPreMove();

		await migration.up();

		const gp = await colls.gameMetadatas.findOne({ _id: "gaia-project" });
		assert.strictEqual(gp!.credits, "- Engine by [@someone](/user/someone)");

		const empty = await colls.gameMetadatas.findOne({ _id: "empty" });
		assert.strictEqual(empty!.credits, "", "an empty credits page still moves (the admin had created one)");

		assert.strictEqual(
			await colls.pages.countDocuments({ "_id.name": "gaia-project:credits", "_id.lang": "en" }),
			0,
			"moved page deleted",
		);
		assert.strictEqual(
			await colls.pages.countDocuments({ "_id.name": "gaia-project:credits", "_id.lang": "fr" }),
			1,
			"non-en page left alone",
		);
		assert.strictEqual(
			await colls.pages.countDocuments({ "_id.name": "credits" }),
			1,
			"the site-wide credits page is not a per-game one",
		);
	});

	it("does not clobber an existing credits field and keeps the page for a later run", async () => {
		await seedPreMove();

		await migration.up();

		const edited = await colls.gameMetadatas.findOne({ _id: "edited" });
		assert.strictEqual(edited!.credits, "edited credits");
		assert.strictEqual(
			await colls.pages.countDocuments({ "_id.name": "edited:credits" }),
			1,
			"unmoved page kept (metadata already has credits)",
		);
	});

	it("is idempotent: a re-run is a no-op", async () => {
		await seedPreMove();
		await migration.up();

		// Admin edits the credits after the first run.
		await colls.gameMetadatas.updateOne({ _id: "gaia-project" }, { $set: { credits: "new credits" } });

		await migration.up();

		const gp = await colls.gameMetadatas.findOne({ _id: "gaia-project" });
		assert.strictEqual(gp!.credits, "new credits", "re-run does not clobber the edited field");
	});

	it("ignores a credits page for a game that has no metadata doc", async () => {
		await db()
			.collection("pages")
			.insertOne({ _id: { name: "ghost:credits", lang: "en" }, title: "Credits", content: "ghost" });

		await migration.up();

		assert.strictEqual(await colls.gameMetadatas.countDocuments({ _id: "ghost" }), 0, "no orphan metadata doc created");
		assert.strictEqual(await colls.pages.countDocuments({ "_id.name": "ghost:credits" }), 1, "page kept");
	});
});
