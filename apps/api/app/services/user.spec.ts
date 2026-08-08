import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { subDays } from "date-fns";
import { db, colls } from "../config/db.ts";
import { testUser, testGame } from "../config/test-helpers.ts";
import env from "../config/env.ts";
import { cleanupDeadUsers, deadUserCandidateFilter, findDeadUsers } from "./user.ts";

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

	before(async () => {
		await db().dropDatabase();

		await colls.users.insertMany([
			testUser({ _id: deadUserId, createdAt: old, security: noActivity }),
			testUser({ _id: secondDeadUserId, createdAt: subDays(Date.now(), 399), security: noActivity }),
			testUser({ _id: gameUserId, createdAt: old, security: noActivity }),
			testUser({ _id: creatorUserId, createdAt: old, security: noActivity }),
			testUser({ _id: chatUserId, createdAt: old, security: noActivity }),
			testUser({ _id: recentUserId, security: noActivity }),
			testUser({ _id: activeUserId, createdAt: old, security: { lastLogin: { ip: "", date: old } } }),
			testUser({ _id: adminUserId, createdAt: old, authority: "admin", security: noActivity }),
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

	it("candidate filter matches only old, never-active, non-admin users", async () => {
		const candidates = await colls.users.find(deadUserCandidateFilter(cutoff)).toArray();
		const ids = candidates.map((u) => u._id.toString());
		for (const expected of [deadUserId, secondDeadUserId, gameUserId, creatorUserId, chatUserId]) {
			assert.ok(ids.includes(expected.toString()), `expected ${expected.toString()} to be a candidate`);
		}
		for (const excluded of [recentUserId, activeUserId, adminUserId]) {
			assert.ok(!ids.includes(excluded.toString()), `expected ${excluded.toString()} to be excluded`);
		}
	});

	it("findDeadUsers only keeps users with no games, no created games, no chat", async () => {
		const dead = await findDeadUsers(cutoff, 50);
		assert.deepEqual(
			dead.map((u) => u._id!.toString()),
			[deadUserId.toString(), secondDeadUserId.toString()],
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
	});

	it("dry-run mode selects but archives nothing", async () => {
		env.cleanupDeadUsers = "dry-run";
		await cleanupDeadUsers();
		assert.ok(await colls.users.findOne({ _id: deadUserId }));
		assert.equal(await colls.deletedUsers.countDocuments({ userId: deadUserId }), 0);
	});

	it("delete mode moves the dead user to deletedUsers and deletes their refresh tokens / game preferences", async () => {
		await colls.jwtRefreshTokens.insertOne({ user: deadUserId, code: "dead-code", createdAt: old });
		await colls.gamePreferences.insertOne({ user: deadUserId, game: "gaia-project" });
		await colls.jwtRefreshTokens.insertOne({ user: chatUserId, code: "chat-code", createdAt: old });

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

		for (const kept of [gameUserId, creatorUserId, chatUserId, recentUserId, activeUserId, adminUserId]) {
			assert.ok(await colls.users.findOne({ _id: kept }), `expected ${kept.toString()} to be kept`);
		}
		assert.equal(await colls.jwtRefreshTokens.countDocuments({ user: chatUserId }), 1);
	});

	it("deletedUsers has no declared unique index (a re-archived user must not hit a constraint)", async () => {
		// The driver's indexes() doesn't flag the mandatory `_id_` as unique, so any index
		// reported as unique is a declared one — and there must be none.
		const uniqueIndexes = (await colls.deletedUsers.indexes()).filter((i) => i.unique);
		assert.deepEqual(uniqueIndexes, []);
	});

	it("the batch-size cap still applies when archiving", async () => {
		env.cleanupDeadUsersBatchSize = 1;
		try {
			await cleanupDeadUsers();
		} finally {
			env.cleanupDeadUsersBatchSize = 50;
		}
		// deadUserId is already archived; with a cap of 1 this run archives the next
		// (secondDeadUserId) and nothing else — one stays in users.
		assert.equal(await colls.users.countDocuments({ _id: secondDeadUserId }), 0);
		assert.equal(await colls.deletedUsers.countDocuments({ userId: secondDeadUserId }), 1);
		assert.equal(await colls.deletedUsers.estimatedDocumentCount(), 2);
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

		await cleanupDeadUsers();

		assert.equal(await colls.users.findOne({ _id: deadUserId }), null);
		assert.equal(await colls.deletedUsers.countDocuments({ userId: deadUserId }), 2);
	});
});
