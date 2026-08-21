// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { ObjectId } from "mongodb";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { migration } from "./1.12.0-prefix-forum-topic-titles.ts";

type Call = { method: string; path: string; body?: Record<string, unknown> };

describe("migration 1.12.0 — prefix existing forum topic titles & tags", () => {
	let savedToken: string | undefined;
	let savedForumUrl: string;
	let calls: Call[];
	// Topics the stub forum "hosts": tid → topic + main post. Re-seeded per test.
	let topics: Map<number, { title: string; mainPid: number; content: string; failGets?: boolean }>;

	const forumOrigin = () => new URL(env.forumUrl).origin;

	before(() => {
		savedToken = env.forumWriteToken;
		savedForumUrl = env.forumUrl;
		env.forumWriteToken = "test-write-token";
		env.forumUrl = "http://forum.test";
		const realFetch = globalThis.fetch;
		mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
			if (url.origin !== forumOrigin()) {
				return realFetch(input, init);
			}
			const method = (init?.method ?? "GET").toUpperCase();
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint request shape
			const body = (typeof init?.body === "string" ? JSON.parse(init.body) : undefined) as
				| Record<string, unknown>
				| undefined;
			calls.push({ method, path: url.pathname, body });

			const topicMatch = /^\/api\/v3\/topics\/(\d+)$/.exec(url.pathname);
			const tagsMatch = /^\/api\/v3\/topics\/(\d+)\/tags$/.exec(url.pathname);
			const postMatch = /^\/api\/v3\/posts\/(\d+)$/.exec(url.pathname);

			if (topicMatch && method === "GET") {
				const topic = topics.get(Number(topicMatch[1]));
				if (!topic || topic.failGets) {
					return new Response("{}", { status: 404 });
				}
				return Response.json({
					response: { tid: Number(topicMatch[1]), title: topic.title, mainPid: topic.mainPid, tags: [] },
				});
			}
			if (postMatch && method === "GET") {
				const topic = [...topics.values()].find((t) => t.mainPid === Number(postMatch[1]));
				if (!topic) {
					return new Response("{}", { status: 404 });
				}
				return Response.json({ response: { pid: topic.mainPid, content: topic.content } });
			}
			if (postMatch && method === "PUT") {
				const topic = [...topics.values()].find((t) => t.mainPid === Number(postMatch[1]));
				if (!topic) {
					return new Response("{}", { status: 404 });
				}
				topic.title = typeof body?.title === "string" ? body.title : topic.title;
				return Response.json({ response: { pid: topic.mainPid } });
			}
			if (tagsMatch && method === "PUT") {
				if (!topics.has(Number(tagsMatch[1]))) {
					return new Response("{}", { status: 404 });
				}
				return Response.json({ response: [] });
			}
			return new Response("{}", { status: 404 });
		});
	});

	beforeEach(async () => {
		calls = [];
		topics = new Map();
		await colls.feedbackRequests.deleteMany({});
		await colls.gameMetadatas.deleteMany({});
	});

	after(async () => {
		mock.restoreAll();
		env.forumWriteToken = savedToken;
		env.forumUrl = savedForumUrl;
		await db().dropDatabase();
	});

	async function seedRequests() {
		await colls.feedbackRequests.insertMany([
			{
				_id: new ObjectId(),
				kind: "site",
				title: "Add dark mode",
				requestedBy: new ObjectId(),
				likeCount: 0,
				status: "open",
				forumTid: 101,
				createdAt: new Date(),
			},
			{
				_id: new ObjectId(),
				kind: "game",
				game: "somegame",
				title: "New maps",
				requestedBy: new ObjectId(),
				likeCount: 0,
				status: "open",
				forumTid: 102,
				createdAt: new Date(),
			},
			{
				_id: new ObjectId(),
				kind: "site",
				title: "Already prefixed",
				requestedBy: new ObjectId(),
				likeCount: 0,
				status: "open",
				forumTid: 103,
				createdAt: new Date(),
			},
			{
				_id: new ObjectId(),
				kind: "site",
				title: "Deleted topic",
				requestedBy: new ObjectId(),
				likeCount: 0,
				status: "open",
				forumTid: 104,
				createdAt: new Date(),
			},
		]);
		await colls.gameMetadatas.insertMany([
			{ _id: "somegame", label: "Some Game", players: [2] },
			{ _id: "wanted-game", label: "Wanted Game", players: [], status: "requested", forumTid: 105, likeCount: 1 },
		]);
		topics.set(101, { title: "Add dark mode", mainPid: 1001, content: "body 101" });
		topics.set(102, { title: "New maps", mainPid: 1002, content: "body 102" });
		topics.set(103, { title: "[Site feedback] Already prefixed", mainPid: 1003, content: "body 103" });
		// 104 exists in the db but not on the forum (deleted) — every GET 404s.
		topics.set(105, { title: "Wanted Game", mainPid: 1005, content: "body 105" });
	}

	it("retitles & tags unprefixed topics, skips already-prefixed ones, survives failures", async () => {
		await seedRequests();

		await migration.up();

		// Site feedback: retitled via a main-post edit (content re-sent unchanged), then tagged.
		assert.strictEqual(topics.get(101)!.title, "[Site feedback] Add dark mode");
		const postEdit101 = calls.find((c) => c.method === "PUT" && c.path === "/api/v3/posts/1001");
		assert.deepStrictEqual(postEdit101?.body, { content: "body 101", title: "[Site feedback] Add dark mode" });
		const tags101 = calls.find((c) => c.method === "PUT" && c.path === "/api/v3/topics/101/tags");
		assert.deepStrictEqual(tags101?.body, { tags: ["site-feedback"] });

		// Game-specific feedback: prefix is the game's label, tag is the slug.
		assert.strictEqual(topics.get(102)!.title, "[Some Game] New maps");
		const tags102 = calls.find((c) => c.method === "PUT" && c.path === "/api/v3/topics/102/tags");
		assert.deepStrictEqual(tags102?.body, { tags: ["somegame"] });

		// Whole-game request.
		assert.strictEqual(topics.get(105)!.title, "[Game request] Wanted Game");
		const tags105 = calls.find((c) => c.method === "PUT" && c.path === "/api/v3/topics/105/tags");
		assert.deepStrictEqual(tags105?.body, { tags: ["game-request"] });

		// Already-prefixed topic: read but never written to.
		assert.strictEqual(topics.get(103)!.title, "[Site feedback] Already prefixed");
		assert.ok(
			!calls.some(
				(c) => c.method === "PUT" && (c.path === "/api/v3/posts/1003" || c.path.startsWith("/api/v3/topics/103")),
			),
		);

		// Deleted topic: logged & skipped, did not abort the migration (105 was still done).
		assert.ok(!calls.some((c) => c.method === "PUT" && c.path.startsWith("/api/v3/topics/104")));
	});

	it("is idempotent: a re-run only reads, never writes", async () => {
		await seedRequests();
		await migration.up();
		calls = [];

		await migration.up();

		assert.ok(
			calls.some((c) => c.method === "GET"),
			"topics are still read",
		);
		assert.ok(
			!calls.some((c) => c.method === "PUT"),
			`no writes on re-run, got: ${JSON.stringify(calls.filter((c) => c.method === "PUT"))}`,
		);
	});

	it("does nothing without a forum write token", async () => {
		await seedRequests();
		env.forumWriteToken = undefined;
		try {
			await migration.up();
		} finally {
			env.forumWriteToken = "test-write-token";
		}
		assert.strictEqual(calls.length, 0, "the forum is never contacted without a token");
		assert.strictEqual(topics.get(101)!.title, "Add dark mode");
	});
});
