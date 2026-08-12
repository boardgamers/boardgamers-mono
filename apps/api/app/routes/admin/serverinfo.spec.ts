import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { ObjectId } from "mongodb";
import { closeNodebbDb, colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

// Node's test runner runs spec files in separate processes, so stubbing the
// global fetch here only affects this file's process — the route module picks
// it up at call time. The real forum is never contacted.
const forumUrl = () => new URL(env.forumUrl);
let forumStatus = 200;
let forumFetchCount = 0;

const realFetch = globalThis.fetch;

describe("Admin serverinfo forum health", () => {
	let adminHeaders: Record<string, string>;

	before(async () => {
		const adminId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: adminId, authority: "admin" }));
		const tokenDoc = { user: adminId, codeHash: hashRefreshCode(generateRefreshCode()), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], true);
		adminHeaders = { Authorization: `Bearer ${token}` };

		// Simulate the forum db: point the read-only NodeBB connection at the SAME
		// test db (mirrors user.spec.ts) and seed an `objects` collection fixture:
		// 4 users (2 with posts), 5 posts, 2 linked bgs accounts.
		const bgsUrl = new URL(env.database.bgs.url.replace(/^mongodb:/, "http:"));
		env.database.nodebb = `mongodb://${bgsUrl.host}/${env.database.bgs.name}${bgsUrl.search}`;
		await closeNodebbDb();
		await db()
			.collection("objects")
			.insertMany([
				{ _key: "user:1", postcount: 7 },
				{ _key: "user:2", postcount: 0 },
				{ _key: "user:3", postcount: 2 },
				{ _key: "user:0" }, // NodeBB's system uid — included, matching the /^user:\d+$/ count
				{ _key: "boardgamersId:uid", [adminId.toHexString()]: 1, [new ObjectId().toHexString()]: 2 },
				...Array.from({ length: 5 }, (_, i) => ({ _key: `pid:${i + 1}`, uid: 1 })),
				{ _key: "post:queue", count: 3 }, // non-pid key: must not count as a post
				{ _key: "username:sorted" }, // non-user key: must not count as a user
			]);

		mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
			if (url.origin === forumUrl().origin) {
				forumFetchCount++;
				if (forumStatus === 0) {
					throw new TypeError("fetch failed");
				}
				return new Response("{}", { status: forumStatus });
			}
			// Requests to the API server under test go through for real.
			return realFetch(input, init);
		});
	});

	after(async () => {
		mock.restoreAll();
		await db().dropDatabase();
	});

	interface ForumInfo {
		ok: boolean;
		status: number | null;
		stats: { users: number; linked: number; usersWithPosts: number; posts: number } | null;
	}

	async function serverinfo() {
		const res = await fetch(`${baseURL()}/api/admin/serverinfo`, { headers: adminHeaders });
		assert.equal(res.status, 200, "the endpoint itself must always succeed");
		const body: unknown = await res.json();
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- trusted own-endpoint shape
		return (body as { forum: ForumInfo }).forum;
	}

	it("probes {forumUrl}/api/config and reports up on 200", async () => {
		forumStatus = 200;
		forumFetchCount = 0;
		const forum = await serverinfo();
		assert.deepEqual({ ok: forum.ok, status: forum.status }, { ok: true, status: 200 });
		assert.ok(forumFetchCount > 0, "forum must be contacted");
	});

	it("reports down on a non-2xx forum response, with the status", async () => {
		forumStatus = 503;
		const forum = await serverinfo();
		assert.deepEqual({ ok: forum.ok, status: forum.status }, { ok: false, status: 503 });
	});

	it("reports down with status null when the forum is unreachable, without failing the request", async () => {
		forumStatus = 0;
		const forum = await serverinfo();
		assert.deepEqual({ ok: forum.ok, status: forum.status }, { ok: false, status: null });
	});

	it("reports forum db stats from the NodeBB objects collection", async () => {
		forumStatus = 200;
		const forum = await serverinfo();
		// Fixture: user:0..3 (2 with posts), 5 pid:* docs, 2 linked bgs accounts.
		assert.deepEqual(forum.stats, { users: 4, linked: 2, usersWithPosts: 2, posts: 5 });
	});

	it("returns null stats when the forum db is unreachable, without failing the request", async () => {
		const saved = env.database.nodebb;
		env.database.nodebb = "mongodb://127.0.0.1:1/nodebb";
		await closeNodebbDb();
		try {
			const forum = await serverinfo();
			assert.equal(forum.stats, null);
		} finally {
			env.database.nodebb = saved;
			await closeNodebbDb(); // reset so later tests reconnect to the fixture db
		}
	});
});
