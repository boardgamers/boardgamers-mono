// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { MAX_PAGE_HISTORY_VERSIONS } from "@bgs/models";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

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

interface PageBody {
	_id: { name: string; lang: string };
	title: string;
	content: string;
}

interface HistoryListEntry {
	_id: string;
	page: { name: string; lang: string };
	title: string;
	editedBy: string;
	editedByUsername: string | null;
	createdAt: string;
}

describe("Admin pages API — edit history (#350)", () => {
	const adminId = new ObjectId();
	const userId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	before(async () => {
		// Clean slate: this spec asserts exact history-entry counts, so leftover
		// pages/history from a previous (failed) run would skew them.
		await Promise.all([colls.pages.deleteMany({}), colls.pageHistories.deleteMany({})]);
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: userId }));
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);
	});

	after(() => db().dropDatabase());

	it("creating a page records no history (there is no previous version)", async () => {
		const res = await api("PUT", "/api/admin/page/source/en", adminHeaders, { title: "Source", content: "v1" });
		assert.strictEqual(res.status, 200);

		assert.strictEqual(await colls.pageHistories.countDocuments({ page: { name: "source", lang: "en" } }), 0);
	});

	it("updating a page archives the previous version with the editor and timestamp", async () => {
		const editStart = new Date();
		const res = await api("PUT", "/api/admin/page/source/en", adminHeaders, { title: "Source", content: "v2" });
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.equal((res.data as PageBody).content, "v2");

		const entries = await colls.pageHistories.find({ page: { name: "source", lang: "en" } }).toArray();
		assert.strictEqual(entries.length, 1);
		assert.equal(entries[0].title, "Source");
		assert.equal(entries[0].content, "v1");
		assert.equal(entries[0].editedBy.toHexString(), adminId.toHexString());
		assert.ok(entries[0].createdAt);
		assert.ok(entries[0].createdAt >= editStart && entries[0].createdAt <= new Date());
	});

	it("restoring a version is a normal edit: it reverts the content and is itself recorded", async () => {
		const listRes = await api("GET", "/api/admin/page/source/en/history", adminHeaders);
		assert.strictEqual(listRes.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const list = listRes.data as HistoryListEntry[];
		assert.strictEqual(list.length, 1);

		const entryRes = await api("GET", `/api/admin/page/source/en/history/${list[0]._id}`, adminHeaders);
		assert.strictEqual(entryRes.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const entry = entryRes.data as HistoryListEntry & { content: string };
		assert.equal(entry.content, "v1");

		// Restore: PUT the archived content back.
		const restore = await api("PUT", "/api/admin/page/source/en", adminHeaders, {
			title: entry.title,
			content: entry.content,
		});
		assert.strictEqual(restore.status, 200);

		const page = await colls.pages.findOne({ _id: { name: "source", lang: "en" } });
		assert.equal(page?.content, "v1");

		// The restore archived "v2" — the full timeline is kept. (Same-ms edits get
		// identical createdAt values, so assert on the set, not the order.)
		const contents = await colls.pageHistories
			.find({ page: { name: "source", lang: "en" } })
			.map((e) => e.content)
			.toArray();
		assert.deepEqual(contents.toSorted(), ["v1", "v2"]);
	});

	it("deleting a page archives its last version", async () => {
		const res = await api("DELETE", "/api/admin/page/source/en", adminHeaders);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "source", lang: "en" } }), 0);

		const entries = await colls.pageHistories
			.find({ page: { name: "source", lang: "en" } })
			.sort({ createdAt: 1, _id: 1 })
			.toArray();
		assert.strictEqual(entries.length, 3);
		assert.equal(entries[2].content, "v1");
		assert.equal(entries[2].editedBy.toHexString(), adminId.toHexString());
	});

	it("the history list is newest-first and omits the content bodies", async () => {
		await api("PUT", "/api/admin/page/credits/en", adminHeaders, { title: "Credits", content: "c1" });
		await api("PUT", "/api/admin/page/credits/en", adminHeaders, { title: "Credits", content: "c2" });
		await api("PUT", "/api/admin/page/credits/en", adminHeaders, { title: "Credits v2", content: "c3" });

		const res = await api("GET", "/api/admin/page/credits/en/history", adminHeaders);
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const list = res.data as (HistoryListEntry & { content?: string })[];
		// Both edits archived the pre-edit page, whose title was "Credits" both times.
		assert.strictEqual(list.length, 2);
		assert.deepEqual(
			list.map((e) => e.title),
			["Credits", "Credits"],
		);
		assert.ok(list[0].createdAt >= list[1].createdAt, "newest first");
		for (const entry of list) {
			assert.ok(!("content" in entry), "list entries must not carry the content body");
			const editor = await colls.users.findOne({ _id: adminId });
			assert.equal(entry.editedByUsername, editor?.account.username);
		}
	});

	it("404s on an unknown or cross-page history entry id", async () => {
		const res = await api("GET", "/api/admin/page/credits/en/history", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const id = (res.data as HistoryListEntry[])[0]._id;

		assert.strictEqual((await api("GET", `/api/admin/page/other/en/history/${id}`, adminHeaders)).status, 404);
		assert.strictEqual(
			(await api("GET", `/api/admin/page/credits/en/history/${new ObjectId().toHexString()}`, adminHeaders)).status,
			404,
		);
		assert.strictEqual((await api("GET", "/api/admin/page/credits/en/history/not-an-id", adminHeaders)).status, 404);
	});

	it("caps the history at MAX_PAGE_HISTORY_VERSIONS per page", async () => {
		// Seed MAX+5 entries with strictly increasing createdAt (via the API the
		// timestamps would tie at ms resolution and make the trim's order racy).
		const pageId = { name: "capped", lang: "en" };
		const base = Date.now() - (MAX_PAGE_HISTORY_VERSIONS + 5) * 1000;
		await colls.pageHistories.insertMany(
			Array.from({ length: MAX_PAGE_HISTORY_VERSIONS + 5 }, (_, i) => ({
				page: pageId,
				title: "Capped",
				content: `v${i}`,
				editedBy: adminId,
				createdAt: new Date(base + i * 1000),
			})),
		);
		// One more edit through the API records a version and triggers the trim.
		await colls.pages.insertOne({ _id: pageId, title: "Capped", content: "current" });
		const res = await api("PUT", "/api/admin/page/capped/en", adminHeaders, { title: "Capped", content: "next" });
		assert.strictEqual(res.status, 200);

		const kept = await colls.pageHistories
			.find({ page: pageId })
			.sort({ createdAt: 1, _id: 1 })
			.map((e) => e.content)
			.toArray();
		assert.strictEqual(kept.length, MAX_PAGE_HISTORY_VERSIONS);
		assert.equal(kept[0], "v6", "the oldest versions were trimmed");
		assert.equal(kept[kept.length - 1], "current", "the just-archived version is kept");
	});

	it("requires admin for the history endpoints", async () => {
		assert.strictEqual((await api("GET", "/api/admin/page/credits/en/history")).status, 403);
		assert.strictEqual((await api("GET", "/api/admin/page/credits/en/history", userHeaders)).status, 403);
		const res = await api("GET", "/api/admin/page/credits/en/history", adminHeaders);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const id = (res.data as HistoryListEntry[])[0]._id;
		assert.strictEqual((await api("GET", `/api/admin/page/credits/en/history/${id}`, userHeaders)).status, 403);
	});
});
