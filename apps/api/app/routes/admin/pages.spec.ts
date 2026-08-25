// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ObjectId } from "mongodb";
import { MAX_PAGE_HISTORY_VERSIONS } from "@bgs/models";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";
import { ACTION_RATE_LIMITS } from "../../services/actionratelimit.ts";

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
	translatedFrom?: { lang: string; updatedAt: string };
	createdAt?: string;
	updatedAt?: string;
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

describe("Admin pages API — LLM translation (#306)", () => {
	const adminId = new ObjectId();
	const userId = new ObjectId();
	const scopedId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;
	let scopedHeaders: Record<string, string>;

	// Stub OpenAI-compatible chat-completions server: echoes a recognizable
	// translation and records the requests it was called with. When
	// `llmFinishReason` is set, answers with that finish_reason and a partial
	// body (simulating a completion cut off by the token limit).
	let llm: http.Server;
	let llmCalls: { system: string; user: string; maxTokens: number }[];
	let llmFinishReason: string | undefined;

	before(async () => {
		await Promise.all([colls.pages.deleteMany({}), colls.pageHistories.deleteMany({})]);
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: userId }));
		// Per-boardgame admin: may translate their game's pages, nothing else.
		await colls.users.insertOne(testUser({ _id: scopedId, adminGrants: ["gameinfo:gaia"] }));
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);
		scopedHeaders = await makeAuthHeaders(scopedId);

		llmCalls = [];
		llmFinishReason = undefined;
		llm = http.createServer((req, res) => {
			let raw = "";
			req.on("data", (chunk) => (raw += chunk));
			req.on("end", () => {
				assert.strictEqual(req.url, "/chat/completions");
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse is any; fields are defaulted below
				const body = JSON.parse(raw) as { messages: { role: string; content: string }[]; max_tokens?: number };
				const user = body.messages.find((m) => m.role === "user")?.content ?? "";
				llmCalls.push({
					system: body.messages.find((m) => m.role === "system")?.content ?? "",
					user,
					maxTokens: body.max_tokens ?? 0,
				});
				res.setHeader("content-type", "application/json");
				const content = `[de] ${user.split("\n\n").at(-1)}`;
				res.end(
					JSON.stringify({
						choices: [
							llmFinishReason
								? { message: { content: content.slice(0, 12) }, finish_reason: llmFinishReason }
								: { message: { content }, finish_reason: "stop" },
						],
					}),
				);
			});
		});
		await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", resolve));
		env.translation.apiKey = "test-key";
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listen(0, "127.0.0.1") binds a TCP port, so the address is an AddressInfo
		env.translation.baseUrl = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
	});

	after(async () => {
		env.translation.apiKey = "";
		env.translation.baseUrl = "https://openrouter.ai/api/v1";
		await new Promise((resolve) => llm.close(resolve));
		await db().dropDatabase();
	});

	it("translates a page into a new language (title + content, terminology-preserving prompt)", async () => {
		await api("PUT", "/api/admin/page/about/en", adminHeaders, {
			title: "About us",
			content: "# Welcome\nPlay **Gaia Project** online.",
		});
		llmCalls = [];

		const res = await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "de" });
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const page = res.data as PageBody;
		assert.deepEqual(page._id, { name: "about", lang: "de" });
		assert.equal(page.title, "[de] About us");
		assert.equal(page.content, "[de] # Welcome\nPlay **Gaia Project** online.");

		// One completion per field, each carrying the terminology-preservation rule.
		assert.strictEqual(llmCalls.length, 2);
		for (const call of llmCalls) {
			assert.match(call.system, /Do NOT translate boardgame names/);
			assert.match(call.user, /from en to de/);
		}

		// Token budget: a flat generous cap (not input-sized) so reasoning-model
		// thinking tokens can't eat into the answer; it only bounds runaway loops.
		for (const call of llmCalls) {
			assert.ok(call.maxTokens >= 32768, `max_tokens ${call.maxTokens} leaves no headroom for reasoning tokens`);
		}

		// A create-upsert has no previous version to archive.
		assert.strictEqual(await colls.pageHistories.countDocuments({ page: { name: "about", lang: "de" } }), 0);
	});

	it("502s without saving when the model truncates the completion (finish_reason length)", async () => {
		await api("PUT", "/api/admin/page/cut/en", adminHeaders, {
			title: "Cut",
			content: "A long page that the model will truncate.",
		});
		llmFinishReason = "length";
		try {
			const res = await api("POST", "/api/admin/page/cut/en/translate", adminHeaders, { targetLang: "de" });
			assert.strictEqual(res.status, 502);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- error body shape
			assert.match((res.data as { message: string }).message, /truncated/);
		} finally {
			llmFinishReason = undefined;
		}

		// The truncated page must not have been upserted.
		assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "cut", lang: "de" } }), 0);
		assert.strictEqual(await colls.pageHistories.countDocuments({ page: { name: "cut", lang: "de" } }), 0);
	});

	it("treats the 'max_tokens' finish_reason variant as truncation too", async () => {
		llmFinishReason = "max_tokens";
		try {
			const res = await api("POST", "/api/admin/page/cut/en/translate", adminHeaders, { targetLang: "de" });
			assert.strictEqual(res.status, 502);
		} finally {
			llmFinishReason = undefined;
		}
		assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "cut", lang: "de" } }), 0);
	});

	it("overwriting an existing translation archives the previous version", async () => {
		const res = await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "de" });
		assert.strictEqual(res.status, 200);

		const entries = await colls.pageHistories.find({ page: { name: "about", lang: "de" } }).toArray();
		assert.strictEqual(entries.length, 1);
		assert.equal(entries[0].title, "[de] About us");
		assert.equal(entries[0].editedBy.toHexString(), adminId.toHexString());
	});

	it("supports an explicit sourceLang different from the URL lang", async () => {
		const res = await api("POST", "/api/admin/page/about/de/translate", adminHeaders, {
			targetLang: "fr",
			sourceLang: "en",
		});
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.deepEqual((res.data as PageBody)._id, { name: "about", lang: "fr" });
	});

	it("accepts a region subtag target (pt-BR), canonicalizing its casing", async () => {
		const res = await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "PT-br" });
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const page = res.data as PageBody;
		assert.deepEqual(page._id, { name: "about", lang: "pt-BR" });
		assert.equal(page.title, "[de] About us");

		// Reachable through the exact-language escape hatch too.
		const served = await api("GET", "/api/page/about/pt-BR");
		assert.strictEqual(served.status, 200);
	});

	it("rejects translating a page into its own language", async () => {
		const res = await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "en" });
		assert.strictEqual(res.status, 400);
	});

	it("validates targetLang", async () => {
		assert.strictEqual(
			(await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "x" })).status,
			400,
		);
		assert.strictEqual(
			(await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "../../etc" })).status,
			400,
		);
		assert.strictEqual(
			(await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "de-DE-DE" })).status,
			400,
		);
		assert.strictEqual((await api("POST", "/api/admin/page/about/en/translate", adminHeaders, {})).status, 400);
	});

	it("404s when the source page does not exist", async () => {
		assert.strictEqual(
			(await api("POST", "/api/admin/page/nope/en/translate", adminHeaders, { targetLang: "de" })).status,
			404,
		);
		assert.strictEqual(
			(await api("POST", "/api/admin/page/about/fr/translate", adminHeaders, { targetLang: "de", sourceLang: "it" }))
				.status,
			404,
		);
	});

	it("503s when no translation API key is configured", async () => {
		const key = env.translation.apiKey;
		env.translation.apiKey = "";
		try {
			const res = await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "de" });
			assert.strictEqual(res.status, 503);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- error body shape
			assert.match((res.data as { message: string }).message, /not configured/);
		} finally {
			env.translation.apiKey = key;
		}
	});

	it("stamps translatedFrom with the source's updatedAt at translation time", async () => {
		const res = await api("POST", "/api/admin/page/about/en/translate", adminHeaders, { targetLang: "da" });
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const page = res.data as PageBody;
		assert.equal(page.translatedFrom?.lang, "en");

		const source = await colls.pages.findOne({ _id: { name: "about", lang: "en" } });
		assert.ok(source?.updatedAt);
		assert.equal(page.translatedFrom?.updatedAt, source.updatedAt.toISOString());
	});

	it("clears translatedFrom on a manual save (manually maintained translation)", async () => {
		const tracked = await colls.pages.findOne({ _id: { name: "about", lang: "da" } });
		assert.ok(tracked?.translatedFrom, "precondition: the da page is a tracked translation");

		const res = await api("PUT", "/api/admin/page/about/da", adminHeaders, {
			title: tracked.title,
			content: `${tracked.content} (manual touch)`,
			// A stale client may round-trip the field — it must be dropped anyway.
			translatedFrom: tracked.translatedFrom,
		});
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.ok(!(res.data as PageBody).translatedFrom, "the response no longer tracks a source");
		assert.ok(
			!(await colls.pages.findOne({ _id: { name: "about", lang: "da" } }))?.translatedFrom,
			"the stored page no longer tracks a source",
		);
	});

	it("leaves translations' stamps alone when the source is edited (→ outdated)", async () => {
		const translation = await colls.pages.findOne({ _id: { name: "about", lang: "de" } });
		assert.ok(translation?.translatedFrom, "precondition: the de page is a tracked translation");

		// Ensures the source's new updatedAt is strictly newer (ms resolution).
		await new Promise((resolve) => setTimeout(resolve, 10));
		const res = await api("PUT", "/api/admin/page/about/en", adminHeaders, {
			title: "About us",
			content: "# Welcome\nPlay **Gaia Project** online. (updated)",
		});
		assert.strictEqual(res.status, 200);

		const reloaded = await colls.pages.findOne({ _id: { name: "about", lang: "de" } });
		assert.deepEqual(reloaded?.translatedFrom, translation.translatedFrom);
		const source = await colls.pages.findOne({ _id: { name: "about", lang: "en" } });
		assert.ok(
			source?.updatedAt && translation.translatedFrom && source.updatedAt > translation.translatedFrom.updatedAt,
			"the source is now newer than the stamp → the translation is outdated",
		);
	});

	it("the page listing projects updatedAt + translatedFrom for outdated computation", async () => {
		const res = await api("GET", "/api/admin/page", adminHeaders);
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const listed = (res.data as PageBody[]).find((p) => p._id.name === "about" && p._id.lang === "de");
		assert.ok(listed, "the de about page is listed");
		assert.equal(listed.translatedFrom?.lang, "en");
		assert.ok(listed.updatedAt, "updatedAt is projected");
	});

	it("requires page access: a plain user is denied, a scoped game admin may translate their game's pages", async () => {
		assert.strictEqual(
			(await api("POST", "/api/admin/page/about/en/translate", userHeaders, { targetLang: "de" })).status,
			403,
		);
		assert.strictEqual((await api("POST", "/api/admin/page/about/en/translate")).status, 403);

		await api("PUT", "/api/admin/page/gaia:rules/en", adminHeaders, {
			title: "Rules",
			content: "The Terrans terraform.",
		});
		// The scoped admin can't touch site-wide pages…
		assert.strictEqual(
			(await api("POST", "/api/admin/page/about/en/translate", scopedHeaders, { targetLang: "de" })).status,
			403,
		);
		// …but can translate their own game's pages.
		const res = await api("POST", "/api/admin/page/gaia:rules/en/translate", scopedHeaders, { targetLang: "de" });
		assert.strictEqual(res.status, 200);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		assert.deepEqual((res.data as PageBody)._id, { name: "gaia:rules", lang: "de" });
	});
});

describe("Admin pages API — bulk translation (#306)", () => {
	const adminId = new ObjectId();
	const userId = new ObjectId();
	let adminHeaders: Record<string, string>;
	let userHeaders: Record<string, string>;

	// Same fake-LLM pattern as the translate suite; `llmFailOn` fails any
	// completion whose text contains the marker (per-page/lang failure
	// isolation).
	let llm: http.Server;
	let llmFailOn: string | undefined;

	before(async () => {
		await Promise.all([colls.pages.deleteMany({}), colls.pageHistories.deleteMany({})]);
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		await colls.users.insertOne(testUser({ _id: userId }));
		adminHeaders = await makeAuthHeaders(adminId);
		userHeaders = await makeAuthHeaders(userId);

		llmFailOn = undefined;
		llm = http.createServer((req, res) => {
			let raw = "";
			req.on("data", (chunk) => (raw += chunk));
			req.on("end", () => {
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse is any; fields are defaulted below
				const body = JSON.parse(raw) as { messages: { role: string; content: string }[] };
				const user = body.messages.find((m) => m.role === "user")?.content ?? "";
				res.setHeader("content-type", "application/json");
				if (llmFailOn && user.includes(llmFailOn)) {
					res.statusCode = 500;
					res.end(JSON.stringify({ error: { message: "upstream boom" } }));
					return;
				}
				res.end(
					JSON.stringify({
						choices: [{ message: { content: `[t] ${user.split("\n\n").at(-1)}` }, finish_reason: "stop" }],
					}),
				);
			});
		});
		await new Promise<void>((resolve) => llm.listen(0, "127.0.0.1", resolve));
		env.translation.apiKey = "test-key";
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listen(0, "127.0.0.1") binds a TCP port, so the address is an AddressInfo
		env.translation.baseUrl = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
	});

	after(async () => {
		env.translation.apiKey = "";
		env.translation.baseUrl = "https://openrouter.ai/api/v1";
		await new Promise((resolve) => llm.close(resolve));
		await db().dropDatabase();
	});

	interface BulkJob {
		status: "running" | "done";
		total: number;
		done: number;
		translated: number;
		skipped: number;
		errors: { page: string; lang: string; message: string }[];
	}

	async function runBulk(body: unknown, headers = adminHeaders): Promise<BulkJob> {
		const res = await api("POST", "/api/admin/page/translate-bulk", headers, body);
		assert.strictEqual(res.status, 202);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		const { jobId } = res.data as { jobId: string };
		for (let i = 0; i < 200; i++) {
			const poll = await api("GET", `/api/admin/page/translate-bulk/${jobId}`, headers);
			assert.strictEqual(poll.status, 200);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
			const job = poll.data as BulkJob;
			if (job.status === "done") {
				return job;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error("bulk job did not finish in time");
	}

	it("translates every page missing in the target language, skipping existing ones", async () => {
		await api("PUT", "/api/admin/page/alpha/en", adminHeaders, { title: "Alpha", content: "First page" });
		await api("PUT", "/api/admin/page/beta/en", adminHeaders, { title: "Beta", content: "Second page" });
		// beta already has a (manual) es version — must stay untouched.
		await api("PUT", "/api/admin/page/beta/es", adminHeaders, { title: "Beta es", content: "Versión española" });

		const job = await runBulk({ targetLang: "es" });
		assert.equal(job.translated, 1, "only alpha/es was missing");
		assert.equal(job.skipped, 1, "beta/es already existed");
		assert.deepEqual(job.errors, []);

		const alpha = await colls.pages.findOne({ _id: { name: "alpha", lang: "es" } });
		assert.equal(alpha?.title, "[t] Alpha");
		assert.equal(alpha?.translatedFrom?.lang, "en");
		const beta = await colls.pages.findOne({ _id: { name: "beta", lang: "es" } });
		assert.equal(beta?.content, "Versión española", "the existing translation was not overwritten");
	});

	it("re-translates outdated translations but leaves up-to-date ones alone", async () => {
		// gamma: translated (stamped), then the source is edited → outdated.
		await api("PUT", "/api/admin/page/gamma/en", adminHeaders, { title: "Gamma", content: "v1" });
		await api("POST", "/api/admin/page/gamma/en/translate", adminHeaders, { targetLang: "hi" });
		const stamped = await colls.pages.findOne({ _id: { name: "gamma", lang: "hi" } });
		await new Promise((resolve) => setTimeout(resolve, 10));
		await api("PUT", "/api/admin/page/gamma/en", adminHeaders, { title: "Gamma", content: "v2" });
		// delta: a hi version that matches its source's current updatedAt → up
		// to date (seeded directly — the single-target translate endpoint's own
		// rate limit is spent by the translate suite).
		const deltaSource = await colls.pages.findOne({ _id: { name: "delta", lang: "en" } });
		await colls.pages.insertOne({
			_id: { name: "delta", lang: "hi" },
			title: "Delta hi",
			content: "seeded up-to-date",
			translatedFrom: { lang: "en", updatedAt: deltaSource?.updatedAt ?? new Date() },
		});

		const job = await runBulk({ targetLang: "hi" });
		assert.equal(job.translated, 3, "the outdated gamma/hi was re-translated; alpha/beta/hi were missing");
		assert.equal(job.skipped, 1, "only the up-to-date delta was skipped");
		assert.deepEqual(job.errors, []);

		const gamma = await colls.pages.findOne({ _id: { name: "gamma", lang: "hi" } });
		assert.equal(gamma?.content, "[t] v2", "the outdated translation was refreshed from the new source");
		assert.ok(
			gamma?.translatedFrom &&
				stamped?.translatedFrom &&
				gamma.translatedFrom.updatedAt > stamped.translatedFrom.updatedAt,
			"the re-translation re-stamped the source's newer updatedAt",
		);
		const delta = await colls.pages.findOne({ _id: { name: "delta", lang: "hi" } });
		assert.equal(delta?.content, "seeded up-to-date", "the up-to-date translation was untouched");
	});

	it("translates one page into every supported locale where missing (pageName mode)", async () => {
		await api("PUT", "/api/admin/page/epsilon/en", adminHeaders, { title: "Epsilon", content: "New page" });

		const job = await runBulk({ pageName: "epsilon" });
		// 10 locales total: en is the source (skipped), the other 9 are created.
		assert.equal(job.total, 10);
		assert.equal(job.translated, 9);
		assert.equal(job.skipped, 1);
		assert.deepEqual(job.errors, []);

		const langs = await colls.pages
			.find({ "_id.name": "epsilon" })
			.map((p) => p._id.lang)
			.toArray();
		assert.deepEqual(langs.toSorted(), ["da", "de", "el", "en", "fr", "hi", "pl", "pt-BR", "ro", "ru"]);
	});

	it("isolates per-page failures: one failing page doesn't block the others", async () => {
		await api("PUT", "/api/admin/page/zeta/en", adminHeaders, { title: "Zeta", content: "boom marker page" });
		await api("PUT", "/api/admin/page/eta/en", adminHeaders, { title: "Eta", content: "fine page" });
		llmFailOn = "boom marker";
		try {
			const job = await runBulk({ targetLang: "it" });
			assert.equal(job.translated, 6, "alpha, beta, gamma, delta, epsilon, eta translated");
			assert.equal(job.errors.length, 1);
			assert.equal(job.errors[0].page, "zeta");
			assert.equal(job.errors[0].lang, "it");
		} finally {
			llmFailOn = undefined;
		}
		assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "zeta", lang: "it" } }), 0);
		assert.strictEqual(await colls.pages.countDocuments({ _id: { name: "eta", lang: "it" } }), 1);
	});

	// Every hit on the endpoint counts against the bulk rate limit — even
	// rejected ones — so all non-202 probes share ONE test, run with a
	// temporary per-admin override so the suite's own budget is untouched.
	it("validates the request body and requires page access", async (t) => {
		const override = { max: 100, windowMs: 60 * 60 * 1000 };
		ACTION_RATE_LIMITS["admin/translate-bulk"] = override;
		t.after(() => {
			ACTION_RATE_LIMITS["admin/translate-bulk"] = { max: 5, windowMs: 60 * 60 * 1000 };
		});

		assert.strictEqual((await api("POST", "/api/admin/page/translate-bulk", adminHeaders, {})).status, 400);
		assert.strictEqual(
			(await api("POST", "/api/admin/page/translate-bulk", adminHeaders, { targetLang: "es", pageName: "alpha" }))
				.status,
			400,
		);
		assert.strictEqual(
			(await api("POST", "/api/admin/page/translate-bulk", adminHeaders, { targetLang: "../../etc" })).status,
			400,
		);
		assert.strictEqual(
			(await api("POST", "/api/admin/page/translate-bulk", userHeaders, { targetLang: "es" })).status,
			403,
		);
		assert.strictEqual((await api("GET", "/api/admin/page/translate-bulk/nope", adminHeaders)).status, 404);
	});
});
