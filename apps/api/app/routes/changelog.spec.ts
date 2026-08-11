// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../config/db.ts";
import env from "../config/env.ts";
import { testUser } from "../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, headers?: Record<string, string>, body?: unknown) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data };
}

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], true);
	return { Authorization: `Bearer ${token}` };
}

interface ChangelogEntryBody {
	_id: string;
	content: string;
	details?: string;
	github?: string;
	published: boolean;
	createdAt: string;
	updatedAt?: string;
}

function insertEntry(overrides: {
	content: string;
	details?: string;
	github?: string;
	published?: boolean;
	createdAt?: Date;
}) {
	return colls.changelogs.insertOne({
		_id: new ObjectId(),
		content: overrides.content,
		...(overrides.details ? { details: overrides.details } : {}),
		...(overrides.github ? { github: overrides.github } : {}),
		published: overrides.published ?? true,
		createdAt: overrides.createdAt ?? new Date(),
	});
}

describe("Changelog API", () => {
	const adminId = new ObjectId();
	const userId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	before(async () => {
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: userId }));
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);
	});

	after(() => db().dropDatabase());

	beforeEach(async () => {
		await colls.changelogs.deleteMany({});
		await colls.settings.deleteMany({ _id: "announcement" });
	});

	describe("GET /api/site/changelog", () => {
		it("returns published entries newest-first and hides drafts", async () => {
			await insertEntry({ content: "oldest", createdAt: new Date("2024-01-01T00:00:00Z") });
			await insertEntry({ content: "newest", createdAt: new Date("2024-03-01T00:00:00Z") });
			await insertEntry({ content: "draft", published: false, createdAt: new Date("2024-04-01T00:00:00Z") });
			await insertEntry({ content: "middle", createdAt: new Date("2024-02-01T00:00:00Z") });

			const res = await api("GET", "/api/site/changelog");
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const entries = res.data as ChangelogEntryBody[];
			assert.deepEqual(
				entries.map((e) => e.content),
				["newest", "middle", "oldest"],
			);
		});

		it("includes the optional details and github fields", async () => {
			await insertEntry({
				content: "🚀 New feature",
				details: "Longer **markdown** explanation.",
				github: "https://github.com/boardgamers/boardgamers-mono/pull/231",
			});

			const res = await api("GET", "/api/site/changelog");
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const [entry] = res.data as ChangelogEntryBody[];
			assert.equal(entry.details, "Longer **markdown** explanation.");
			assert.equal(entry.github, "https://github.com/boardgamers/boardgamers-mono/pull/231");
		});

		it("paginates with limit and the before cursor", async () => {
			for (let i = 1; i <= 5; i++) {
				await insertEntry({ content: `entry${i}`, createdAt: new Date(`2024-01-0${i}T00:00:00Z`) });
			}

			const first = await api("GET", "/api/site/changelog?limit=2");
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const page1 = first.data as ChangelogEntryBody[];
			assert.deepEqual(
				page1.map((e) => e.content),
				["entry5", "entry4"],
			);

			const second = await api("GET", `/api/site/changelog?limit=2&before=${encodeURIComponent(page1[1].createdAt)}`);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const page2 = second.data as ChangelogEntryBody[];
			assert.deepEqual(
				page2.map((e) => e.content),
				["entry3", "entry2"],
			);

			const third = await api("GET", `/api/site/changelog?limit=2&before=${encodeURIComponent(page2[1].createdAt)}`);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const page3 = third.data as ChangelogEntryBody[];
			assert.deepEqual(
				page3.map((e) => e.content),
				["entry1"],
			);
		});

		it("rejects an invalid cursor and over-large limits", async () => {
			assert.strictEqual((await api("GET", "/api/site/changelog?before=not-a-date")).status, 400);
			assert.strictEqual((await api("GET", "/api/site/changelog?limit=500")).status, 400);
		});

		it("lazily seeds from the legacy announcement blob when the collection is empty, only once", async () => {
			await colls.settings.insertOne({
				_id: "announcement",
				value: { title: "Recent changes", content: "First change<br>\nSecond change" },
			});

			const res = await api("GET", "/api/site/changelog");
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const entries = res.data as ChangelogEntryBody[];
			assert.deepEqual(
				entries.map((e) => e.content),
				["First change", "Second change"],
			);

			// Second call: no duplicate seeding.
			const again = await api("GET", "/api/site/changelog");
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.strictEqual((again.data as ChangelogEntryBody[]).length, 2);
		});
	});

	describe("GET /api/site/announcement", () => {
		it("stitches the latest 4 published entries into the legacy { title, content } shape", async () => {
			for (let i = 1; i <= 6; i++) {
				await insertEntry({ content: `change ${i}`, createdAt: new Date(2024, 0, i) });
			}

			const res = await api("GET", "/api/site/announcement");
			assert.strictEqual(res.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const body = res.data as { title: string; content: string };
			assert.equal(body.title, "Recent changes");
			assert.equal(body.content, ["change 6", "change 5", "change 4", "change 3"].join("<br>\n"));
		});

		it("returns an empty body when there is nothing to announce", async () => {
			// Koa answers an undefined ctx.body with 204 No Content.
			const res = await api("GET", "/api/site/announcement");
			assert.strictEqual(res.status, 204);
		});
	});

	describe("admin CRUD", () => {
		it("creates an entry (published by default) and lists it", async () => {
			const res = await api("POST", "/api/admin/changelog", adminHeaders, {
				content: "🪐 Gaia Project: Ivits available",
				details: "The Ivits are now playable.",
				github: "https://github.com/boardgamers/boardgamers-mono/pull/231",
			});
			assert.strictEqual(res.status, 201);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const created = res.data as ChangelogEntryBody;
			assert.equal(created.published, true);
			assert.ok(created.createdAt);

			const list = await api("GET", "/api/admin/changelog", adminHeaders);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const entries = list.data as ChangelogEntryBody[];
			assert.strictEqual(entries.length, 1);
			assert.equal(entries[0].content, "🪐 Gaia Project: Ivits available");
			assert.equal(entries[0].details, "The Ivits are now playable.");
			assert.equal(entries[0].github, "https://github.com/boardgamers/boardgamers-mono/pull/231");

			// And the entry is immediately public.
			const publicList = await api("GET", "/api/site/changelog");
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.strictEqual((publicList.data as ChangelogEntryBody[]).length, 1);
		});

		it("creates a draft that stays hidden from the public list until published", async () => {
			const res = await api("POST", "/api/admin/changelog", adminHeaders, {
				content: "not ready",
				published: false,
			});
			assert.strictEqual(res.status, 201);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const draft = res.data as ChangelogEntryBody;

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.strictEqual(((await api("GET", "/api/site/changelog")).data as unknown[]).length, 0);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			assert.strictEqual(((await api("GET", "/api/admin/changelog", adminHeaders)).data as unknown[]).length, 1);

			const put = await api("PUT", `/api/admin/changelog/${draft._id}`, adminHeaders, { published: true });
			assert.strictEqual(put.status, 200);

			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const publicEntries = (await api("GET", "/api/site/changelog")).data as ChangelogEntryBody[];
			assert.strictEqual(publicEntries.length, 1);
		});

		it("edits content/details and stamps updatedAt, keeping createdAt", async () => {
			const created = await insertEntry({ content: "gaia porject", details: "typo details" });
			const original = (await colls.changelogs.findOne({ _id: created.insertedId }))!;

			const res = await api("PUT", `/api/admin/changelog/${created.insertedId.toHexString()}`, adminHeaders, {
				content: "🪐 Gaia Project",
				details: "fixed details",
			});
			assert.strictEqual(res.status, 200);

			const afterUpdate = (await colls.changelogs.findOne({ _id: created.insertedId }))!;
			assert.equal(afterUpdate.content, "🪐 Gaia Project");
			assert.equal(afterUpdate.details, "fixed details");
			assert.deepEqual(afterUpdate.createdAt, original.createdAt);
			assert.ok(afterUpdate.updatedAt && afterUpdate.updatedAt > original.createdAt);
		});

		it("clears details/github when an empty string is sent", async () => {
			const created = await insertEntry({
				content: "entry",
				details: "some details",
				github: "https://github.com/boardgamers/boardgamers-mono/pull/1",
			});

			const res = await api("PUT", `/api/admin/changelog/${created.insertedId.toHexString()}`, adminHeaders, {
				details: "",
				github: "",
			});
			assert.strictEqual(res.status, 200);

			const afterUpdate = (await colls.changelogs.findOne({ _id: created.insertedId }))!;
			assert.ok(!("details" in afterUpdate));
			assert.ok(!("github" in afterUpdate));
		});

		it("deletes an entry", async () => {
			const created = await insertEntry({ content: "gone" });
			const res = await api("DELETE", `/api/admin/changelog/${created.insertedId.toHexString()}`, adminHeaders);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(await colls.changelogs.countDocuments(), 0);
		});

		it("404s on unknown or malformed ids", async () => {
			const unknown = new ObjectId().toHexString();
			assert.strictEqual(
				(await api("PUT", `/api/admin/changelog/${unknown}`, adminHeaders, { content: "x" })).status,
				404,
			);
			assert.strictEqual((await api("DELETE", `/api/admin/changelog/${unknown}`, adminHeaders)).status, 404);
			assert.strictEqual(
				(await api("PUT", "/api/admin/changelog/not-an-objectid", adminHeaders, { content: "x" })).status,
				400,
			);
		});

		it("rejects empty/invalid payloads and no-op updates", async () => {
			assert.strictEqual((await api("POST", "/api/admin/changelog", adminHeaders, { content: "  " })).status, 400);
			assert.strictEqual((await api("POST", "/api/admin/changelog", adminHeaders, {})).status, 400);
			assert.strictEqual(
				(await api("POST", "/api/admin/changelog", adminHeaders, { content: "x", github: "not-a-url" })).status,
				400,
			);
			const created = await insertEntry({ content: "entry" });
			assert.strictEqual(
				(await api("PUT", `/api/admin/changelog/${created.insertedId.toHexString()}`, adminHeaders, {})).status,
				400,
			);
		});

		it("requires admin for every endpoint", async () => {
			const created = await insertEntry({ content: "entry" });
			const id = created.insertedId.toHexString();

			// isAdmin rejects anonymous and regular users alike with 403.
			for (const headers of [undefined, userHeaders]) {
				assert.strictEqual((await api("GET", "/api/admin/changelog", headers)).status, 403);
				assert.strictEqual((await api("POST", "/api/admin/changelog", headers, { content: "y" })).status, 403);
				assert.strictEqual((await api("PUT", `/api/admin/changelog/${id}`, headers, { content: "x" })).status, 403);
				assert.strictEqual((await api("DELETE", `/api/admin/changelog/${id}`, headers)).status, 403);
			}
		});
	});
});
