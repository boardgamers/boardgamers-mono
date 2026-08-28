// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testGame, testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { Authorization: `Bearer ${token}` };
}

// #334: the home-page lobby samples open games one-per-creator for variety, but when
// there are FEW open games (< the display count) the dedup shouldn't hide same-author
// games — they're shown to fill the page.
//
// The test db is shared across spec files, so each test uses a UNIQUE game name
// (registered as public) and asserts on its own games only — other suites' open games
// can't leak into the sample.
describe("GET /game/status/open?sample — same-author fill", () => {
	let seq = 0;
	const prefix = `sample-${Date.now()}-`;

	// Clean up this suite's games + game registrations so repeated runs against the
	// shared (persistent) test db don't accumulate them.
	after(async () => {
		await colls.games.deleteMany({ "game.name": { $regex: `^${prefix}` } });
		await colls.gameInfos.deleteMany({ "_id.game": { $regex: `^${prefix}` } });
		await colls.gameMetadatas.deleteMany({ _id: { $regex: `^${prefix}` } });
	});

	async function registerGame(name: string) {
		await colls.gameInfos.insertOne({
			_id: { game: name, version: 1 },
			viewer: { url: `//test.com/${name}`, topLevelVariable: name },
			public: true,
			meta: {},
		});
		await colls.gameMetadatas.insertOne({ _id: name, label: name, players: [2], needOwnership: false });
	}

	async function sampleOpen(game: string, count: number): Promise<string[]> {
		const res = await fetch(`${baseURL()}/api/game/status/open?sample=true&count=${count}&boardgame=${game}`);
		assert.equal(res.status, 200);
		const games: { _id: string }[] = await res.json();
		return games.map((g) => g._id);
	}

	it("fills the page with same-author games when there are fewer open games than the count", async () => {
		const name = `${prefix}few-${seq++}`;
		await registerGame(name);
		const creator = new ObjectId();
		const other = new ObjectId();
		// 3 by one creator + 1 by another = 4 total, under the count of 5.
		await colls.games.insertMany([
			testGame({ _id: `${name}-a1`, creator, game: { name, version: 1 } }),
			testGame({ _id: `${name}-a2`, creator, game: { name, version: 1 } }),
			testGame({ _id: `${name}-a3`, creator, game: { name, version: 1 } }),
			testGame({ _id: `${name}-b1`, creator: other, game: { name, version: 1 } }),
		]);

		const ids = await sampleOpen(name, 5);
		// All 4 shown — the same-author games are NOT deduped away.
		assert.deepEqual([...ids].sort(), [`${name}-a1`, `${name}-a2`, `${name}-a3`, `${name}-b1`]);
	});

	it("keeps one-game-per-creator variety when there are many open games", async () => {
		const name = `${prefix}many-${seq++}`;
		await registerGame(name);
		// 8 distinct creators + 3 extra by one of them = 11 total, over the count of 5.
		const docs = [];
		for (let i = 0; i < 8; i++) {
			docs.push(testGame({ _id: `${name}-c${i}`, creator: new ObjectId(), game: { name, version: 1 } }));
		}
		const repeatCreator = new ObjectId();
		for (let i = 0; i < 3; i++) {
			docs.push(testGame({ _id: `${name}-x${i}`, creator: repeatCreator, game: { name, version: 1 } }));
		}
		await colls.games.insertMany(docs);

		const ids = await sampleOpen(name, 5);
		assert.equal(ids.length, 5);
		// With plenty of distinct creators, the sample is all-distinct (variety).
		const creators = await colls.games
			.find({ _id: { $in: ids } })
			.map((g) => String(g.creator))
			.toArray();
		assert.equal(new Set(creators).size, creators.length);
	});
});

// A game on a private-beta version (public: false) is above a non-grantee's
// accessible ceiling, so filterAccessibleGames hides it from their /game/status/*
// lists. But an invited player is pushed into `players` (pending) and must still see
// the game to accept the invite — the "players bypass the visibility gate" clause.
describe("GET /game/status/* — private-beta game visible to its players", () => {
	const prefix = `beta-${Date.now()}-`;
	const game = `${prefix}game`;
	const openGameId = `${game}-open`;
	const activeGameId = `${game}-active`;
	const creatorId = new ObjectId();
	const inviteeId = new ObjectId();
	const outsiderId = new ObjectId();
	let inviteeAuth: Record<string, string> = {};
	let outsiderAuth: Record<string, string> = {};

	after(async () => {
		await colls.games.deleteMany({ "game.name": game });
		await colls.gameInfos.deleteMany({ "_id.game": game });
		await colls.gameMetadatas.deleteMany({ _id: game });
		await colls.users.deleteMany({ _id: { $in: [creatorId, inviteeId, outsiderId] } });
	});

	it("shows a beta-version game to an invited player but not to an outsider", async () => {
		// v1 public, v2 private beta — a non-grantee's accessible ceiling is v1.
		await colls.gameInfos.insertMany([
			{ _id: { game, version: 1 }, viewer: { url: `//test.com/${game}` }, public: true, meta: {} },
			{ _id: { game, version: 2 }, viewer: { url: `//test.com/${game}` }, public: false, meta: {} },
		]);
		await colls.gameMetadatas.insertOne({ _id: game, label: game, players: [2], needOwnership: false });

		await colls.users.insertOne(testUser({ _id: inviteeId, account: { username: `${prefix}inv` } }));
		await colls.users.insertOne(testUser({ _id: outsiderId, account: { username: `${prefix}out` } }));
		inviteeAuth = await makeAuthHeaders(inviteeId);
		outsiderAuth = await makeAuthHeaders(outsiderId);

		// Both games run on the private-beta v2; the invitee is a (pending) player.
		await colls.games.insertMany([
			testGame({
				_id: openGameId,
				creator: creatorId,
				game: { name: game, version: 2 },
				players: [{ _id: inviteeId, pending: true }],
			}),
			testGame({
				_id: activeGameId,
				creator: creatorId,
				status: "active",
				game: { name: game, version: 2 },
				players: [{ _id: creatorId }, { _id: inviteeId }],
			}),
		]);

		const listAs = async (auth: Record<string, string>, status: string) => {
			const res = await fetch(`${baseURL()}/api/game/status/${status}?boardgame=${game}`, { headers: auth });
			assert.equal(res.status, 200);
			const games: { _id: string }[] = await res.json();
			return games.map((g) => g._id);
		};

		// The invitee sees both their open (pending invite) and active beta games.
		assert.ok((await listAs(inviteeAuth, "open")).includes(openGameId), "invitee sees the open beta game");
		assert.ok((await listAs(inviteeAuth, "active")).includes(activeGameId), "invitee sees the active beta game");

		// An outsider (no grant, not a player) sees neither.
		assert.ok(!(await listAs(outsiderAuth, "open")).includes(openGameId), "outsider does not see the open beta game");
		assert.ok(
			!(await listAs(outsiderAuth, "active")).includes(activeGameId),
			"outsider does not see the active beta game",
		);
	});
});
