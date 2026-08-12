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

		// Sync-drift fixture: 4 more bgs users, all linked to a forum account —
		//  1 in sync (case-insensitive email match), 1 username drift, 1 email drift,
		//  1 drifting on both and unconfirmed. Plus 2 dangling links (bgs user deleted
		//  / forum user deleted), which must count in linkedTotal but not as drift.
		const syncedId = new ObjectId();
		const usernameDriftId = new ObjectId();
		const emailDriftId = new ObjectId();
		const bothDriftId = new ObjectId();
		const ghostBgsId = new ObjectId();
		await colls.users.insertMany([
			testUser({
				_id: syncedId,
				account: { username: "synced", email: "synced@test.com" },
				security: { confirmed: true },
			}),
			testUser({
				_id: usernameDriftId,
				account: { username: "Alice Doe", email: "alice@test.com" },
				security: { confirmed: true },
			}),
			testUser({
				_id: emailDriftId,
				account: { username: "bob", email: "bob@old.com" },
				security: { confirmed: true },
			}),
			testUser({
				_id: bothDriftId,
				account: { username: "carol", email: "carol@old.com" },
				security: { confirmed: false },
			}),
		]);
		const tokenDoc = { user: adminId, codeHash: hashRefreshCode(generateRefreshCode()), createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], true);
		adminHeaders = { Authorization: `Bearer ${token}` };

		// Simulate the forum db: point the read-only NodeBB connection at the SAME
		// test db (mirrors user.spec.ts) and seed an `objects` collection fixture:
		// 6 users (2 with posts), 1008 posts (global.postCount), 8 linked bgs accounts
		// (admin + the 6 above + 1 unparseable entry).
		const bgsUrl = new URL(env.database.bgs.url.replace(/^mongodb:/, "http:"));
		env.database.nodebb = `mongodb://${bgsUrl.host}/${env.database.bgs.name}${bgsUrl.search}`;
		await closeNodebbDb();
		await db()
			.collection("objects")
			.insertMany([
				{ _key: "user:1", username: "admin", email: "admin@forum.com", postcount: 7 },
				{ _key: "user:2", username: "synced", email: "SYNCED@test.com", postcount: 0 },
				{ _key: "user:3", username: "alice-doe", email: "alice@test.com", postcount: 2 },
				{ _key: "user:4", username: "bob", email: "bob@new.com" },
				{ _key: "user:5", username: "Carol", email: "carol@new.com" },
				{ _key: "user:0" }, // NodeBB's system uid — included, matching the /^user:\d+$/ count
				{
					_key: "boardgamersId:uid",
					[adminId.toHexString()]: 1,
					[syncedId.toHexString()]: 2,
					[usernameDriftId.toHexString()]: 3,
					[emailDriftId.toHexString()]: 4,
					[bothDriftId.toHexString()]: 5,
					[ghostBgsId.toHexString()]: 6, // bgs user deleted — dangling, not drift
					[new ObjectId().toHexString()]: 99, // forum user:99 missing — dangling, not drift
					"not-an-objectid": 7, // unparseable link entry — skipped entirely
				},
				{ _key: "global", postCount: 1008 },
				// Posts are `post:<pid>` docs; the endpoint reads global.postCount, so
				// these are decorative realism (and must not count as users).
				{ _key: "post:11", pid: 11, uid: 1 },
				{ _key: "post:12", pid: 12, uid: 3 },
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

	interface ForumSyncSample {
		forumUsername: string | null;
		bgsUsername: string | null;
		forumEmail: string | null;
		bgsEmail: string | null;
	}
	interface ForumSync {
		linkedTotal: number;
		usernameMismatch: number;
		emailMismatch: number;
		unconfirmedLinked: number;
		sample: ForumSyncSample[];
	}
	interface ForumInfo {
		ok: boolean;
		status: number | null;
		stats: { users: number; linked: number; usersWithPosts: number; posts: number } | null;
		forumSync: ForumSync | null;
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
		// Fixture: user:0..5 (2 with posts), global.postCount=1008, 8 entries in the
		// boardgamersId:uid link doc (raw count — the unparseable entry included).
		assert.deepEqual(forum.stats, { users: 6, linked: 8, usersWithPosts: 2, posts: 1008 });
	});

	it("returns null stats when the forum db is unreachable, without failing the request", async () => {
		const saved = env.database.nodebb;
		env.database.nodebb = "mongodb://127.0.0.1:1/nodebb";
		await closeNodebbDb();
		try {
			const forum = await serverinfo();
			assert.equal(forum.stats, null);
			assert.equal(forum.forumSync, null);
		} finally {
			env.database.nodebb = saved;
			await closeNodebbDb(); // reset so later tests reconnect to the fixture db
		}
	});

	it("reports bgs↔forum account drift over the linked pairs", async () => {
		forumStatus = 200;
		const forum = await serverinfo();
		const sync = forum.forumSync;
		assert.ok(sync, "forumSync must be present when the forum db is reachable");
		// 8 raw entries in boardgamersId:uid — the unparseable "not-an-objectid"
		// key is skipped, leaving 7 links: admin + 4 fixture users + 2 dangling.
		// Dangling pairs (bgs user deleted / forum user deleted) count in the
		// total but not as drift.
		assert.equal(sync.linkedTotal, 7);
		// username: admin ≠ user1 (the auto-generated admin username drifts on the
		// forum), alice-doe ≠ Alice Doe, Carol ≠ carol. synced matches.
		assert.equal(sync.usernameMismatch, 3);
		// email: admin@forum ≠ user1@test, bob@old ≠ bob@new, carol@old ≠ carol@new.
		// synced matches case-insensitively.
		assert.equal(sync.emailMismatch, 3);
		assert.equal(sync.unconfirmedLinked, 1);
		assert.equal(sync.sample.length, 4, "only the drifting pairs are sampled");
		assert.deepEqual(
			[...sync.sample].sort((a, b) => (a.bgsUsername ?? "").localeCompare(b.bgsUsername ?? "")),
			[
				{
					forumUsername: "alice-doe",
					bgsUsername: "Alice Doe",
					forumEmail: "alice@test.com",
					bgsEmail: "alice@test.com",
				},
				{ forumUsername: "bob", bgsUsername: "bob", forumEmail: "bob@new.com", bgsEmail: "bob@old.com" },
				{ forumUsername: "Carol", bgsUsername: "carol", forumEmail: "carol@new.com", bgsEmail: "carol@old.com" },
				{ forumUsername: "admin", bgsUsername: "user1", forumEmail: "admin@forum.com", bgsEmail: "user1@test.com" },
			],
		);
	});
});
