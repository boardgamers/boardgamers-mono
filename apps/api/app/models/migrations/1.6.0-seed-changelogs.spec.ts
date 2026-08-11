// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { SettingsKey } from "@bgs/models";
import { colls, db } from "../../config/db.ts";
import { splitAnnouncementContent } from "../changelogs.ts";
import { migration } from "./1.6.0-seed-changelogs.ts";

describe("migration 1.6.0 — seed changelogs from the announcement", () => {
	after(() => db().dropDatabase());

	beforeEach(async () => {
		await colls.changelogs.deleteMany({});
		await colls.settings.deleteMany({ _id: SettingsKey.Announcement });
	});

	it("splits the <br>-joined blob into one published entry per change", async () => {
		await colls.settings.insertOne({
			_id: SettingsKey.Announcement,
			value: {
				title: "Recent changes",
				content: "Gaia Project: Ivits available<br>\nPowergrid: new Italy map<br><br>Bugfixes",
			},
		});

		await migration.up();

		const entries = await colls.changelogs.find({}).sort({ createdAt: -1 }).toArray();
		assert.deepEqual(
			entries.map((e) => e.content),
			["Gaia Project: Ivits available", "Powergrid: new Italy map", "Bugfixes"],
		);
		assert.ok(entries.every((e) => e.published));
		assert.ok(entries.every((e) => e.title === "Recent changes" && e.createdAt && e._id));
	});

	it("splits markdown paragraphs too, and seeds an unsplittable blob as a single entry", async () => {
		await colls.settings.insertOne({
			_id: SettingsKey.Announcement,
			value: { title: "Recent changes", content: "- first change\n- second change\n\n- third change" },
		});
		await migration.up();
		// Two paragraphs: the tight list stays together, the blank line splits.
		assert.strictEqual(await colls.changelogs.countDocuments(), 2);

		await colls.changelogs.deleteMany({});
		await colls.settings.updateOne(
			{ _id: SettingsKey.Announcement },
			{ $set: { value: { title: "Recent changes", content: "Just one change, no separator" } } },
		);
		await migration.up();
		const entries = await colls.changelogs.find({}).toArray();
		assert.strictEqual(entries.length, 1);
		assert.equal(entries[0].content, "Just one change, no separator");
	});

	it("is idempotent: skips when changelogs already exist, and tolerates a missing/invalid blob", async () => {
		await colls.changelogs.insertOne({
			title: "existing",
			content: "already there",
			published: true,
			createdAt: new Date(),
		});
		await colls.settings.insertOne({
			_id: SettingsKey.Announcement,
			value: { title: "Recent changes", content: "should not be seeded<br>nor this" },
		});

		await migration.up();
		await migration.up();
		assert.strictEqual(await colls.changelogs.countDocuments(), 1);

		// Fresh db without any announcement: no-op, no throw.
		await colls.changelogs.deleteMany({});
		await colls.settings.deleteMany({ _id: SettingsKey.Announcement });
		await migration.up();
		assert.strictEqual(await colls.changelogs.countDocuments(), 0);

		// Malformed blob: no-op.
		await colls.settings.insertOne({ _id: SettingsKey.Announcement, value: "not an announcement" });
		await migration.up();
		assert.strictEqual(await colls.changelogs.countDocuments(), 0);
	});

	it("splitAnnouncementContent handles the separator variants", () => {
		assert.deepEqual(splitAnnouncementContent("a<br>b"), ["a", "b"]);
		assert.deepEqual(splitAnnouncementContent("a<br/>\nb<br />c"), ["a", "b", "c"]);
		assert.deepEqual(splitAnnouncementContent("a\n\nb"), ["a", "b"]);
		assert.deepEqual(splitAnnouncementContent("single"), ["single"]);
		assert.deepEqual(splitAnnouncementContent("  \n "), []);
	});
});
