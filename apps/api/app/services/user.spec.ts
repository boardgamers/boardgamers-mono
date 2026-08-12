import assert from "node:assert/strict";
import { before, after, afterEach, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { subDays } from "date-fns";
import { SettingsKey } from "@bgs/models";
import { db, colls } from "../config/db.ts";
import { testUser, testGame } from "../config/test-helpers.ts";
import env from "../config/env.ts";
import { cleanupDeadUsers, deadUserCandidateFilter, findDeadUsers } from "./user.ts";
import { hashRefreshCode } from "../models/jwtrefreshtokens.ts";

describe("cleanupDeadUsers", () => {
	const cutoff = subDays(Date.now(), 365);
	const old = subDays(Date.now(), 400);

	// makeDefaultUser stamps lastActive/lastLogin/lastOnline with "now" — the fixtures
	// below must clear them so the inactivity filter is actually exercised.
	const noActivity = { lastActive: undefined, lastLogin: undefined, lastOnline: undefined };

	// Distinct createdAt values so findDeadUsers' { createdAt: 1 } sort is deterministic:
	// deadUserId is always the first dead user selected.
	const deadUserId = new ObjectId();
	const secondDeadUserId = new ObjectId();
	const gameUserId = new ObjectId();
	const creatorUserId = new ObjectId();
	const chatUserId = new ObjectId();
	const recentUserId = new ObjectId();
	const activeUserId = new ObjectId();
	const adminUserId = new ObjectId();
	const oauthUserId = new ObjectId();
	const staleOauthUserId = new ObjectId();
	const forumPosterId = new ObjectId();
	// A forum user with a linked account but no posts → still kept (any forum
	// account protects, poster or not).
	const forumLurkerId = new ObjectId();
	const forumPosterUid = 42;
	const forumLurkerUid = 43;
	// Legacy forum users: the session-sharing-era accounts were backfilled into
	// NodeBB's boardgamersId:uid map (the single authoritative link), so they take
	// the same path as OAuth-era accounts — poster or not → kept.
	const legacyPosterId = new ObjectId();
	const legacyLurkerId = new ObjectId();
	const legacyPosterUid = 147;
	const legacyLurkerUid = 148;
	// Only a recent security.lastSeen (e.g. bumped by an OAuth authorize) → kept.
	const lastSeenUserId = new ObjectId();

	before(async () => {
		await db().dropDatabase();

		// The dead-user cleanup is the only consumer of the NodeBB db, and tests run
		// against an isolated db, so point the (read-only) forum connection at a
		// separate collection in the SAME test db to simulate the forum. The bgs url
		// carries its db in the path and replicaSet in the query — rebuild the URL
		// with the nodebb db name in the path (a query-only URL would default to the
		// wrong db).
		const bgsUrl = new URL(env.database.bgs.url.replace(/^mongodb:/, "http:"));
		env.database.nodebb = `mongodb://${bgsUrl.host}/${env.database.bgs.name}${bgsUrl.search}`;

		await colls.users.insertMany([
			testUser({ _id: deadUserId, createdAt: old, security: noActivity }),
			testUser({ _id: secondDeadUserId, createdAt: subDays(Date.now(), 399), security: noActivity }),
			testUser({ _id: gameUserId, createdAt: old, security: noActivity }),
			testUser({ _id: creatorUserId, createdAt: old, security: noActivity }),
			testUser({ _id: chatUserId, createdAt: old, security: noActivity }),
			testUser({ _id: recentUserId, security: noActivity }),
			testUser({ _id: activeUserId, createdAt: old, security: { lastLogin: { ip: "", date: old } } }),
			testUser({ _id: adminUserId, createdAt: old, authority: "admin", security: noActivity }),
			// No site activity at all, but an OAuth consent exists (forum SSO) → kept
			// (conservative backstop).
			testUser({ _id: oauthUserId, createdAt: old, security: noActivity }),
			// Even a consent older than the cutoff protects the user (any OAuth trace = keep).
			testUser({ _id: staleOauthUserId, createdAt: old, security: noActivity }),
			// No site activity, no OAuth — but a forum post (content) → kept.
			testUser({ _id: forumPosterId, createdAt: old, security: noActivity }),
			// No site activity, no OAuth, a forum account but no posts → still kept
			// (any forum account protects, poster or not).
			testUser({ _id: forumLurkerId, createdAt: old, security: noActivity }),
			// Legacy session-sharing accounts, backfilled into boardgamersId:uid →
			// kept, posts or not.
			testUser({ _id: legacyPosterId, createdAt: old, security: noActivity }),
			testUser({ _id: legacyLurkerId, createdAt: old, security: noActivity }),
			// No other activity, but a recent security.lastSeen (e.g. an OAuth authorize
			// bumped it) → excluded by the candidate filter itself.
			testUser({ _id: lastSeenUserId, createdAt: old, security: { ...noActivity, lastSeen: new Date() } }),
		]);
		// Simulated NodeBB `objects` doc: the bgs→forum-uid link, holding both the
		// OAuth-era accounts and the backfilled legacy session-sharing ones. The
		// cleanup never reads posts — link existence alone protects.
		await db()
			.collection("objects")
			.insertOne({
				_key: "boardgamersId:uid",
				[forumPosterId.toHexString()]: forumPosterUid,
				[forumLurkerId.toHexString()]: forumLurkerUid,
				[legacyPosterId.toHexString()]: legacyPosterUid,
				[legacyLurkerId.toHexString()]: legacyLurkerUid,
			});
		await colls.oauthConsents.insertMany([
			{
				userId: oauthUserId,
				clientId: "https://forum.example/client",
				scopes: ["openid"],
				createdAt: old,
				lastUsedAt: new Date(),
			},
			{
				userId: staleOauthUserId,
				clientId: "https://forum.example/client",
				scopes: ["openid"],
				createdAt: old,
				lastUsedAt: old,
			},
		]);
		await colls.games.insertOne(
			testGame({ _id: "played", game: { name: "gaia-project", version: 0 }, players: [{ _id: gameUserId }] }),
		);
		await colls.games.insertOne(
			testGame({ _id: "hosted", game: { name: "gaia-project", version: 0 }, creator: creatorUserId, players: [] }),
		);
		await colls.chatMessages.insertOne({
			room: "lobby",
			author: { _id: chatUserId, name: "chatter" },
			data: { text: "hi" },
			type: "text",
		});
	});

	after(() => db().dropDatabase());

	afterEach(() => colls.settings.deleteMany({ _id: SettingsKey.CleanupDeadUsersLastRun }));

	it("candidate filter matches only old, never-active, non-admin users", async () => {
		const candidates = await colls.users.find(deadUserCandidateFilter(cutoff)).toArray();
		const ids = candidates.map((u) => u._id.toString());
		// The OAuth-consent / forum users pass the candidate filter (no site activity
		// fields set) — those exclusions happen in findDeadUsers, not the pre-filter.
		for (const expected of [
			deadUserId,
			secondDeadUserId,
			gameUserId,
			creatorUserId,
			chatUserId,
			oauthUserId,
			staleOauthUserId,
			forumPosterId,
			forumLurkerId,
			legacyPosterId,
			legacyLurkerId,
		]) {
			assert.ok(ids.includes(expected.toString()), `expected ${expected.toString()} to be a candidate`);
		}
		for (const excluded of [recentUserId, activeUserId, adminUserId, lastSeenUserId]) {
			assert.ok(!ids.includes(excluded.toString()), `expected ${excluded.toString()} to be excluded`);
		}
	});

	it("a user whose only activity is a recent OAuth-bumped security.lastSeen is not a dead candidate", async () => {
		// lastSeen is in ACTIVITY_FIELDS, so the candidate filter itself excludes them.
		const dead = await findDeadUsers(cutoff, 50);
		assert.ok(!dead.some((u) => u._id!.equals(lastSeenUserId)), "a recent lastSeen must keep the user");
	});

	it("findDeadUsers only keeps users with no games, no created games, no chat, no OAuth trace, no forum account", async () => {
		const dead = await findDeadUsers(cutoff, 50);
		assert.deepEqual(
			dead.map((u) => u._id!.toString()).sort(),
			[deadUserId.toString(), secondDeadUserId.toString()].sort(),
		);
	});

	it("a user whose only trace is an OAuth consent (forum SSO) is not cleaned up", async () => {
		const dead = await findDeadUsers(cutoff, 50);
		assert.ok(!dead.some((u) => u._id!.equals(oauthUserId)), "any OAuth consent must count as activity");
	});

	it("a user whose only OAuth consent is older than the cutoff is still kept (any OAuth trace = keep)", async () => {
		const dead = await findDeadUsers(cutoff, 50);
		assert.ok(!dead.some((u) => u._id!.equals(staleOauthUserId)), "even a stale OAuth consent must protect the user");
	});

	it("a user with a forum account (OAuth-era boardgamersId:uid link) but no site activity is not cleaned up", async () => {
		const dead = await findDeadUsers(cutoff, 50);
		assert.ok(!dead.some((u) => u._id!.equals(forumPosterId)), "any forum account must protect");
	});

	it("an OAuth-linked forum account is kept even with zero posts (connection, not content)", async () => {
		const dead = await findDeadUsers(cutoff, 50);
		assert.ok(
			!dead.some((u) => u._id!.equals(forumLurkerId)),
			"a linked forum account without posts must still protect",
		);
	});

	it("a legacy forum account (backfilled into boardgamersId:uid) is kept", async () => {
		const dead = await findDeadUsers(cutoff, 50);
		assert.ok(!dead.some((u) => u._id!.equals(legacyPosterId)), "a backfilled legacy forum link must protect");
	});

	it("a backfilled legacy forum account is kept even with zero posts (connection, not content)", async () => {
		const dead = await findDeadUsers(cutoff, 50);
		assert.ok(
			!dead.some((u) => u._id!.equals(legacyLurkerId)),
			"a backfilled legacy forum account without posts must still protect",
		);
	});

	it("findDeadUsers caps the batch size", async () => {
		assert.equal((await findDeadUsers(cutoff, 1)).length, 1);
		assert.equal((await findDeadUsers(cutoff, 0)).length, 0);
	});

	it("off mode does nothing", async () => {
		env.cleanupDeadUsers = "off";
		await cleanupDeadUsers();
		assert.ok(await colls.users.findOne({ _id: deadUserId }));
		// The lastRunAt stamp is only written for dry-run/delete — off stays inert.
		assert.equal(await colls.settings.countDocuments({ _id: SettingsKey.CleanupDeadUsersLastRun }), 0);
	});

	it("dry-run mode selects but archives nothing", async () => {
		env.cleanupDeadUsers = "dry-run";
		await cleanupDeadUsers();
		assert.ok(await colls.users.findOne({ _id: deadUserId }));
		assert.equal(await colls.deletedUsers.countDocuments({ userId: deadUserId }), 0);
		// Even a dry-run stamps lastRunAt — otherwise an hourly dry-run tick would
		// re-scan and re-log the same candidates every hour.
		assert.equal(await colls.settings.countDocuments({ _id: SettingsKey.CleanupDeadUsersLastRun }), 1);
	});

	it("delete mode moves the dead user to deletedUsers and deletes their refresh tokens / game preferences", async () => {
		await colls.jwtRefreshTokens.insertOne({
			user: deadUserId,
			codeHash: hashRefreshCode("dead-code"),
			createdAt: old,
		});
		await colls.gamePreferences.insertOne({ user: deadUserId, game: "gaia-project" });
		await colls.jwtRefreshTokens.insertOne({
			user: chatUserId,
			codeHash: hashRefreshCode("chat-code"),
			createdAt: old,
		});

		// Ensure this run isn't throttled by a stamp left over from a prior test
		// (the afterEach only clears the stamp after tests that set one).
		await colls.settings.deleteMany({ _id: SettingsKey.CleanupDeadUsersLastRun });
		env.cleanupDeadUsers = "delete";
		await cleanupDeadUsers();

		// Absent from users, present in deletedUsers with the original _id kept as
		// `userId` and a deletedAt stamp.
		assert.equal(await colls.users.findOne({ _id: deadUserId }), null);
		const archived = await colls.deletedUsers.findOne({ userId: deadUserId });
		assert.ok(archived, "expected the dead user to be archived in deletedUsers");
		assert.ok(archived.userId.equals(deadUserId));
		assert.ok(archived.deletedAt instanceof Date);
		assert.equal(archived.account.username, "user1");

		assert.equal(await colls.jwtRefreshTokens.countDocuments({ user: deadUserId }), 0);
		assert.equal(await colls.gamePreferences.countDocuments({ user: deadUserId }), 0);

		for (const kept of [
			gameUserId,
			creatorUserId,
			chatUserId,
			recentUserId,
			activeUserId,
			adminUserId,
			oauthUserId,
			staleOauthUserId,
			forumPosterId,
			forumLurkerId,
			legacyPosterId,
			legacyLurkerId,
			lastSeenUserId,
		]) {
			assert.ok(await colls.users.findOne({ _id: kept }), `expected ${kept.toString()} to be kept`);
		}
		assert.equal(await colls.jwtRefreshTokens.countDocuments({ user: chatUserId }), 1);
	});

	it("fails safe when the forum db is unreachable: keeps users instead of deleting", async () => {
		// Point the NodeBB connection at a dead port and reset it so getNodebbDb()
		// reconnects (and fails). The cleanup must then refuse to archive anyone.
		const { closeNodebbDb } = await import("../config/db.ts");
		const saved = env.database.nodebb;
		env.database.nodebb = "mongodb://127.0.0.1:1/nodebb";
		await closeNodebbDb();
		try {
			const dead = await findDeadUsers(cutoff, 50);
			assert.equal(dead.length, 0, "an unreachable forum db must keep every user (never delete on uncertainty)");
		} finally {
			env.database.nodebb = saved;
			await closeNodebbDb(); // reset so later tests reconnect to the real (test) db
		}
	});

	it("deletedUsers has no declared unique index (a re-archived user must not hit a constraint)", async () => {
		// The driver's indexes() doesn't flag the mandatory `_id_` as unique, so any index
		// reported as unique is a declared one — and there must be none.
		const uniqueIndexes = (await colls.deletedUsers.indexes()).filter((i) => i.unique);
		assert.deepEqual(uniqueIndexes, []);
	});

	it("the batch-size cap still applies when archiving", async () => {
		// Self-contained: two fresh dead users, a cleared throttle stamp, batchSize=1 →
		// exactly one is archived this run, the other stays.
		const capA = new ObjectId();
		const capB = new ObjectId();
		await colls.users.insertMany([
			testUser({ _id: capA, createdAt: old, security: noActivity }),
			testUser({ _id: capB, createdAt: old, security: noActivity }),
		]);
		await colls.settings.deleteMany({ _id: SettingsKey.CleanupDeadUsersLastRun });

		env.cleanupDeadUsers = "delete";
		env.cleanupDeadUsersBatchSize = 1;
		try {
			await cleanupDeadUsers();
		} finally {
			env.cleanupDeadUsersBatchSize = 50;
		}
		assert.equal(await colls.users.countDocuments({ _id: { $in: [capA, capB] } }), 1);
		assert.equal(await colls.deletedUsers.countDocuments({ userId: { $in: [capA, capB] } }), 1);
	});

	it("never re-runs within 24h (deploy-resilient throttling via settings)", async () => {
		// First run stamps lastRunAt; a second immediate call must skip even though a
		// dead user is still selectable (gameUserId has a game, but a fresh dead user
		// would be archived — the stamp alone must prevent that).
		const extraDeadId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: extraDeadId, createdAt: old, security: noActivity }));

		await cleanupDeadUsers(); // archives extraDeadId, stamps lastRunAt
		assert.equal(await colls.users.countDocuments({ _id: extraDeadId }), 0);

		const anotherDeadId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: anotherDeadId, createdAt: old, security: noActivity }));

		await cleanupDeadUsers(); // throttled: lastRunAt is fresh
		assert.ok(await colls.users.findOne({ _id: anotherDeadId }), "expected throttled run to leave the user alone");
	});

	it("runs again once lastRunAt is older than 24h (catch-up after a restart)", async () => {
		// Simulate a restart after more than 24h: fresh process, old stamp.
		await colls.settings.updateOne(
			{ _id: SettingsKey.CleanupDeadUsersLastRun },
			{ $set: { value: subDays(Date.now(), 2).toISOString() } },
			{ upsert: true },
		);

		const restartDeadId = new ObjectId();
		await colls.users.insertOne(testUser({ _id: restartDeadId, createdAt: old, security: noActivity }));

		await cleanupDeadUsers();

		assert.equal(await colls.users.findOne({ _id: restartDeadId }), null);
		assert.equal(await colls.deletedUsers.countDocuments({ userId: restartDeadId }), 1);

		// lastRunAt was refreshed by the run
		const stamp = await colls.settings.findOne({ _id: SettingsKey.CleanupDeadUsersLastRun });
		assert.ok(stamp);
		assert.ok(Date.now() - new Date(String(stamp.value)).getTime() < 60 * 1000);
	});

	it("a restored user (moved back from deletedUsers) can be re-archived despite the same userId", async () => {
		// Restore = re-insert the archived doc into users with `_id: userId`, minus
		// deletedAt/userId. deadUserId is already archived once; restoring it and running
		// the cleanup again archives the same user a second time, which must not hit a
		// duplicate-key (this is why the archive has no unique index on userId/_id).
		const archived = await colls.deletedUsers.findOne({ userId: deadUserId });
		assert.ok(archived, "expected deadUserId to still be archived");
		const { _id: _archiveId, deletedAt: _deletedAt, userId, ...restored } = archived;
		await colls.users.insertOne({ ...restored, _id: userId });
		assert.ok(await colls.users.findOne({ _id: deadUserId }));

		// The previous test throttled the runs — age the stamp so this one executes.
		await colls.settings.updateOne(
			{ _id: SettingsKey.CleanupDeadUsersLastRun },
			{ $set: { value: subDays(Date.now(), 2).toISOString() } },
			{ upsert: true },
		);
		await cleanupDeadUsers();

		assert.equal(await colls.users.findOne({ _id: deadUserId }), null);
		assert.equal(await colls.deletedUsers.countDocuments({ userId: deadUserId }), 2);
	});
});
