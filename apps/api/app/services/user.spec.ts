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

	const deadUserId = new ObjectId();
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
		for (const expected of [deadUserId, gameUserId, creatorUserId, chatUserId]) {
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
			[deadUserId.toString()],
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

	it("dry-run mode selects but deletes nothing", async () => {
		env.cleanupDeadUsers = "dry-run";
		await cleanupDeadUsers();
		assert.ok(await colls.users.findOne({ _id: deadUserId }));
	});

	it("delete mode removes the dead user and their refresh tokens / game preferences only", async () => {
		await colls.jwtRefreshTokens.insertOne({ user: deadUserId, code: "dead-code", createdAt: old });
		await colls.gamePreferences.insertOne({ user: deadUserId, game: "gaia-project" });
		await colls.jwtRefreshTokens.insertOne({ user: chatUserId, code: "chat-code", createdAt: old });

		env.cleanupDeadUsers = "delete";
		await cleanupDeadUsers();

		assert.equal(await colls.users.findOne({ _id: deadUserId }), null);
		assert.equal(await colls.jwtRefreshTokens.countDocuments({ user: deadUserId }), 0);
		assert.equal(await colls.gamePreferences.countDocuments({ user: deadUserId }), 0);

		for (const kept of [gameUserId, creatorUserId, chatUserId, recentUserId, activeUserId, adminUserId]) {
			assert.ok(await colls.users.findOne({ _id: kept }), `expected ${kept.toString()} to be kept`);
		}
		assert.equal(await colls.jwtRefreshTokens.countDocuments({ user: chatUserId }), 1);
	});
});
