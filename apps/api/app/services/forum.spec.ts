// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls, db } from "../config/db.ts";
import env from "../config/env.ts";
import { testUser } from "../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
	const res = await fetch(`${baseURL()}${path}`, {
		method,
		headers: { "Content-Type": "application/json", ...headers },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data: unknown = res.headers.get("content-type")?.includes("application/json")
		? await res.json()
		: await res.text();
	return { status: res.status, data, ok: res.ok };
}

async function insertUserWithAuth(suffix: string) {
	const userId = new ObjectId();
	await colls.users.insertOne(
		testUser({
			_id: userId,
			account: { username: `forumuser${suffix}`, email: `forumuser${suffix}@test.com` },
			security: { confirmed: true, slug: `forumuser${suffix}` },
		}),
	);
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { userId, authHeaders: { Authorization: `Bearer ${token}` } };
}

// Narrow an API error body's structured `code` without an unsafe assertion.
function errorCode(data: unknown): string | undefined {
	return typeof data === "object" && data !== null && "code" in data && typeof data.code === "string"
		? data.code
		: undefined;
}

// Node's test runner runs spec files in separate processes, so stubbing the
// global fetch here only affects this file's process — the forum service picks
// it up at call time. The real forum is never contacted.
const forumUrl = () => new URL(env.forumUrl);

type ForumBehavior =
	| { kind: "ok"; tid: number }
	| { kind: "http"; status: number }
	| { kind: "network" }
	| { kind: "notid" };

let forumBehavior: ForumBehavior = { kind: "ok", tid: 42 };
let forumCalls: {
	cid: number;
	title: string;
	content: string;
	tags?: string[];
	authorization?: string;
	_uid?: number;
}[] = [];

const realFetch = globalThis.fetch;

describe("Forum topics on feedback/game requests (#340)", () => {
	let alice: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let savedToken: string | undefined;
	let savedForumUrl: string;
	let savedNodebb: string;
	// This suite's own fixtures, tracked for precise cleanup — the specs share the
	// process/db and interleave, so a broad delete would hit another suite's data.
	const ownFeedbackIds: ObjectId[] = [];
	const ownGameIds: string[] = [];

	before(async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "forumgame", version: 1 },
			viewer: { url: "//test.com/forumgame" },
			public: true,
		});
		await colls.gameMetadatas.insertOne({ _id: "forumgame", label: "Forum Game", players: [2] });
		alice = await insertUserWithAuth("alice");

		// Site/game feedback is posted on the forum AS the user (#340): the forum-uid
		// lookup reads `env.database.nodebb`. Point it at the SAME test db (the
		// default points at a real forum db) and seed the bgs→forum-uid link doc so
		// alice has a forum account (uid 11). The helper uses its own short-lived
		// connection (no shared cached client), so reassigning the URL is safe; both
		// are restored in after().
		savedNodebb = env.database.nodebb;
		const bgsUrl = new URL(env.database.bgs.url.replace(/^mongodb:/, "http:"));
		env.database.nodebb = `mongodb://${bgsUrl.host}/${env.database.bgs.name}${bgsUrl.search}`;
		// These specs share the process/db and their tests interleave, so upsert
		// (not insert) the single authoritative link doc and never delete it — a
		// delete in one suite's after() would strip another suite's forum accounts
		// mid-run. Each suite adds only its own users' keys.
		await db()
			.collection("objects")
			.updateOne({ _key: "boardgamersId:uid" }, { $set: { [alice.userId.toHexString()]: 11 } }, { upsert: true });
		// The gate also requires the mapped forum user doc to be real (a stale
		// link pointing at a ghost/partial user gates like "not linked").
		await db()
			.collection("objects")
			.updateOne({ _key: "user:11" }, { $set: { username: "forumuseralice" } }, { upsert: true });

		savedToken = env.forumWriteToken;
		savedForumUrl = env.forumUrl;
		env.forumWriteToken = "test-write-token";
		// Point the forum at a loopback origin the fetch stub can recognize (the
		// test setup points it at a dead port; the stub intercepts by origin).
		env.forumUrl = "http://forum.test";

		mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
			if (url.origin === forumUrl().origin) {
				// The route always sends a string JSON body.
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint request shape
				const parsed = (typeof init?.body === "string" ? JSON.parse(init.body) : {}) as {
					cid: number;
					title: string;
					content: string;
					tags?: string[];
					_uid?: number;
				};
				const headers = new Headers(init?.headers);
				forumCalls.push({
					cid: parsed.cid,
					title: parsed.title,
					content: parsed.content,
					tags: parsed.tags,
					authorization: headers.get("authorization") ?? undefined,
					_uid: parsed._uid,
				});
				if (forumBehavior.kind === "network") {
					throw new TypeError("fetch failed");
				}
				if (forumBehavior.kind === "http") {
					return new Response("{}", { status: forumBehavior.status });
				}
				if (forumBehavior.kind === "notid") {
					return Response.json({ response: { noTid: true } });
				}
				return Response.json({ response: { tid: forumBehavior.tid, slug: `topic/${forumBehavior.tid}/some-slug` } });
			}
			// Requests to the API server under test go through for real.
			return realFetch(input, init);
		});
	});

	beforeEach(() => {
		forumCalls = [];
		forumBehavior = { kind: "ok", tid: 42 };
		env.forumWriteToken = "test-write-token";
	});

	after(async () => {
		mock.restoreAll();
		env.forumWriteToken = savedToken;
		env.forumUrl = savedForumUrl;
		env.database.nodebb = savedNodebb;
		// Delete exactly this suite's request/game fixtures (tracked by id) so they
		// don't inflate the other suites' open-request caps or listings — the specs
		// share the db and interleave. The forum-link doc is left in place: deleting
		// it could race a suite still mid-run, and a stale link for this suite's
		// unique users is harmless.
		await colls.feedbackRequests.deleteMany({ _id: { $in: ownFeedbackIds } });
		await colls.gameMetadatas.deleteMany({ _id: { $in: ownGameIds } });
	});

	it("creates a forum topic when a feedback request is created, storing forumTid", async () => {
		forumBehavior = { kind: "ok", tid: 1234 };
		const res = await api(
			"POST",
			"/api/feedback",
			{ kind: "site", title: "Forum topic site request", body: "Please add this feature" },
			alice.authHeaders,
		);
		assert.strictEqual(res.status, 201);
		const created = z.object({ _id: z.string(), forumTid: z.number() }).parse(res.data);
		ownFeedbackIds.push(new ObjectId(created._id));
		assert.strictEqual(created.forumTid, 1234);

		// The topic was posted to the Comments & Feedback category, AS the user
		// (_uid impersonation), with both links, a kind prefix and a forum tag.
		assert.strictEqual(forumCalls.length, 1);
		assert.strictEqual(forumCalls[0].cid, 4);
		assert.strictEqual(forumCalls[0].title, "[Site feedback] Forum topic site request");
		assert.deepStrictEqual(forumCalls[0].tags, ["site-feedback"]);
		assert.strictEqual(forumCalls[0]._uid, 11, "feedback topics are posted as the requester");
		assert.ok(forumCalls[0].content.includes("Please add this feature"));
		assert.ok(forumCalls[0].content.includes("forumuseralice"));
		assert.ok(forumCalls[0].content.includes("https://"));
		assert.strictEqual(forumCalls[0].authorization, "Bearer test-write-token");

		// forumTid is persisted on the doc.
		const doc = await colls.feedbackRequests.findOne({ _id: new ObjectId(created._id) });
		assert.strictEqual(doc?.forumTid, 1234);
	});

	it("falls back to the system write uid when the caller passes no forum uid", async () => {
		const { createFeedbackTopic } = await import("./forum.ts");

		const topic = await createFeedbackTopic({
			title: "Direct service call",
			tag: "Site feedback",
			tags: ["site-feedback"],
			requestUrl: "https://boardgamers.space/feedback",
			username: "someone",
		});

		assert.strictEqual(topic?.tid, 42);
		assert.strictEqual(forumCalls.length, 1);
		assert.strictEqual(forumCalls[0]._uid, 1, "a master token is rejected without any _uid");
		assert.deepStrictEqual(forumCalls[0].tags, ["site-feedback"]);
	});

	it("creates a forum topic when a game request is created, storing forumTid", async () => {
		forumBehavior = { kind: "ok", tid: 555 };
		const res = await api(
			"POST",
			"/api/boardgame/request",
			{ label: "Forum Topic Game", description: "A game we want" },
			alice.authHeaders,
		);
		assert.strictEqual(res.status, 201);
		const created = z.object({ _id: z.string(), forumTid: z.number() }).parse(res.data);
		ownGameIds.push(created._id);
		assert.strictEqual(created.forumTid, 555);

		assert.strictEqual(forumCalls.length, 1);
		assert.strictEqual(forumCalls[0].title, "[Game request] Forum Topic Game");
		assert.deepStrictEqual(forumCalls[0].tags, ["game-request"]);
		assert.strictEqual(forumCalls[0]._uid, 11, "game-request topics are posted as the requester");
		assert.ok(forumCalls[0].content.includes("A game we want"));

		const doc = await colls.gameMetadatas.findOne({ _id: "forum-topic-game" });
		assert.strictEqual(doc?.forumTid, 555);

		// And it is served on the requests listing.
		const list = z
			.array(z.object({ _id: z.string(), forumTid: z.number().optional() }))
			.parse((await api("GET", "/api/boardgame/requests")).data);
		assert.strictEqual(list.find((r) => r._id === "forum-topic-game")?.forumTid, 555);
	});

	it("prefixes game-specific feedback with the game's label and tags it with the game slug", async () => {
		const res = await api(
			"POST",
			"/api/feedback",
			{ kind: "game", game: "forumgame", title: "More maps please" },
			alice.authHeaders,
		);
		assert.strictEqual(res.status, 201);
		const created = z.object({ _id: z.string() }).parse(res.data);
		ownFeedbackIds.push(new ObjectId(created._id));

		assert.strictEqual(forumCalls.length, 1);
		assert.strictEqual(forumCalls[0].title, "[Forum Game] More maps please");
		assert.deepStrictEqual(forumCalls[0].tags, ["forumgame"]);

		// The stored request keeps the raw, unprefixed title.
		const doc = await colls.feedbackRequests.findOne({ _id: new ObjectId(created._id) });
		assert.strictEqual(doc?.title, "More maps please");
	});

	it("truncates the user portion so the prefixed title stays under NodeBB's limit", async () => {
		const longTitle = "x".repeat(200);
		const res = await api("POST", "/api/feedback", { kind: "site", title: longTitle }, alice.authHeaders);
		assert.strictEqual(res.status, 201);
		ownFeedbackIds.push(new ObjectId(z.object({ _id: z.string() }).parse(res.data)._id));

		assert.strictEqual(forumCalls.length, 1);
		assert.strictEqual(forumCalls[0].title, `[Site feedback] ${"x".repeat(200)}`);
		assert.strictEqual(forumCalls[0].title.length, 216);
	});

	it("fails the request (and persists nothing) when the forum returns an error", async () => {
		forumBehavior = { kind: "http", status: 500 };
		const res = await api("POST", "/api/feedback", { kind: "site", title: "Forum down request" }, alice.authHeaders);
		assert.strictEqual(res.status, 503);
		assert.strictEqual(await colls.feedbackRequests.findOne({ title: "Forum down request" }), null);
	});

	it("fails the request (and persists nothing) when the forum is unreachable", async () => {
		forumBehavior = { kind: "network" };
		const res = await api("POST", "/api/boardgame/request", { label: "Unreachable Forum Game" }, alice.authHeaders);
		assert.strictEqual(res.status, 503);
		assert.strictEqual(await colls.gameMetadatas.findOne({ _id: "unreachable-forum-game" }), null);
	});

	it("fails the request (and persists nothing) when the forum response has no tid", async () => {
		forumBehavior = { kind: "notid" };
		const res = await api("POST", "/api/feedback", { kind: "site", title: "No tid response" }, alice.authHeaders);
		assert.strictEqual(res.status, 503);
		assert.strictEqual(await colls.feedbackRequests.findOne({ title: "No tid response" }), null);
	});

	it("fails the request (and persists nothing) when the write token is unset", async () => {
		env.forumWriteToken = undefined;
		const res = await api("POST", "/api/feedback", { kind: "site", title: "No token request" }, alice.authHeaders);
		assert.strictEqual(res.status, 503);
		assert.strictEqual(forumCalls.length, 0, "the forum must not be contacted without a token");
		assert.strictEqual(await colls.feedbackRequests.findOne({ title: "No token request" }), null);
	});

	it("gates site/game feedback on a linked forum account", async () => {
		const noforum = await insertUserWithAuth("noforum");
		const res = await api("POST", "/api/feedback", { kind: "site", title: "No forum account" }, noforum.authHeaders);
		assert.strictEqual(res.status, 403);
		assert.strictEqual(errorCode(res.data), "forum_account_required");
		assert.strictEqual(forumCalls.length, 0, "no topic is created without a forum account");
	});

	it("gates whole-game requests on a linked forum account", async () => {
		const noforum = await insertUserWithAuth("noforumgame");
		const res = await api("POST", "/api/boardgame/request", { label: "No Forum Needed Game" }, noforum.authHeaders);
		assert.strictEqual(res.status, 403);
		assert.strictEqual(errorCode(res.data), "forum_account_required");
		assert.strictEqual(forumCalls.length, 0, "no topic is created without a forum account");
		// The request was NOT created.
		assert.strictEqual(await colls.gameMetadatas.findOne({ _id: "no-forum-needed-game" }), null);
	});

	it("gates like 'not linked' when the link points at a ghost forum user (no username)", async () => {
		// A stale boardgamersId:uid entry: the forum account was deleted but the
		// map entry survived — the mapped user doc is partial (no username).
		const ghost = await insertUserWithAuth("ghostlink");
		await db()
			.collection("objects")
			.updateOne({ _key: "boardgamersId:uid" }, { $set: { [ghost.userId.toHexString()]: 99 } }, { upsert: true });
		await db()
			.collection("objects")
			.updateOne({ _key: "user:99" }, { $set: { fullname: "Ghost", picture: "x" } }, { upsert: true });

		const res = await api("POST", "/api/feedback", { kind: "site", title: "Ghost link request" }, ghost.authHeaders);
		assert.strictEqual(res.status, 403);
		assert.strictEqual(errorCode(res.data), "forum_account_required");
		assert.strictEqual(forumCalls.length, 0, "no topic creation attempted with a ghost link");
	});
});
