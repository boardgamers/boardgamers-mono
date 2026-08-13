// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls, db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { testUser } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

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
			account: { username: `likeuser${suffix}`, email: `likeuser${suffix}@test.com` },
			security: { confirmed: true, slug: `likeuser${suffix}` },
		}),
	);
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { userId, authHeaders: { Authorization: `Bearer ${token}` } };
}

const gameNames = ["likegame-a", "likegame-b", "likegame-c"];

const infoListItem = z.object({
	_id: z.object({ game: z.string(), version: z.number() }),
	likeCount: z.number().optional(),
	liked: z.boolean().optional(),
});

describe("Boardgame API — game likes (#117)", () => {
	let alice: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let bob: Awaited<ReturnType<typeof insertUserWithAuth>>;

	before(async () => {
		for (const game of gameNames) {
			await colls.gameInfos.insertOne({
				_id: { game, version: 1 },
				viewer: { url: `//test.com/${game}` },
				meta: { public: true },
			});
			// Game-level fields (label/players/likeCount) live on the metadata doc (#298).
			await colls.gameMetadatas.insertOne({ _id: game, label: game, players: [2] });
		}
		alice = await insertUserWithAuth("alice");
		bob = await insertUserWithAuth("bob");
	});

	it("requires authentication", async () => {
		assert.strictEqual((await api("POST", "/api/boardgame/likegame-a/like")).status, 401);
		assert.strictEqual((await api("DELETE", "/api/boardgame/likegame-a/like")).status, 401);
	});

	it("404s on unknown games", async () => {
		assert.strictEqual((await api("POST", "/api/boardgame/nope/like", undefined, alice.authHeaders)).status, 404);
	});

	it("likes a game and returns the new state + count", async () => {
		const res = await api("POST", "/api/boardgame/likegame-a/like", undefined, alice.authHeaders);
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, { liked: true, likeCount: 1 });
	});

	it("is idempotent on repeated likes", async () => {
		const res = await api("POST", "/api/boardgame/likegame-a/like", undefined, alice.authHeaders);
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, { liked: true, likeCount: 1 });
		assert.strictEqual(await colls.gameLikes.countDocuments({ game: "likegame-a" }), 1);
	});

	it("accumulates likes across users", async () => {
		const res = await api("POST", "/api/boardgame/likegame-a/like", undefined, bob.authHeaders);
		assert.deepStrictEqual(res.data, { liked: true, likeCount: 2 });
		assert.strictEqual((await colls.gameMetadatas.findOne({ _id: "likegame-a" }))?.likeCount, 2);
	});

	it("unlikes a game, idempotently", async () => {
		const res = await api("DELETE", "/api/boardgame/likegame-a/like", undefined, bob.authHeaders);
		assert.deepStrictEqual(res.data, { liked: false, likeCount: 1 });

		const again = await api("DELETE", "/api/boardgame/likegame-a/like", undefined, bob.authHeaders);
		assert.deepStrictEqual(again.data, { liked: false, likeCount: 1 });

		const fresh = await api("DELETE", "/api/boardgame/likegame-b/like", undefined, bob.authHeaders);
		assert.deepStrictEqual(fresh.data, { liked: false, likeCount: 0 });
	});

	it("exposes liked + likeCount in the game-info list", async () => {
		// State: alice likes likegame-a (1 like), nothing else.
		const anonymous = await api("GET", "/api/boardgame/info");
		assert.strictEqual(anonymous.status, 200);
		const anonItems = z
			.array(infoListItem)
			.parse(anonymous.data)
			.filter((i) => gameNames.includes(i._id.game));
		for (const item of anonItems) {
			assert.strictEqual(item.liked, false);
			assert.strictEqual(item.likeCount ?? 0, item._id.game === "likegame-a" ? 1 : 0);
		}

		const authed = await api("GET", "/api/boardgame/info", undefined, alice.authHeaders);
		const items = z
			.array(infoListItem)
			.parse(authed.data)
			.filter((i) => gameNames.includes(i._id.game));
		for (const item of items) {
			assert.strictEqual(item.liked, item._id.game === "likegame-a");
			assert.strictEqual(item.likeCount ?? 0, item._id.game === "likegame-a" ? 1 : 0);
		}
	});

	it("exposes liked on the single-game endpoint", async () => {
		const res = await api("GET", "/api/boardgame/likegame-a", undefined, alice.authHeaders);
		assert.strictEqual(z.object({ liked: z.boolean() }).parse(res.data).liked, true);

		const other = await api("GET", "/api/boardgame/likegame-a", undefined, bob.authHeaders);
		assert.strictEqual(z.object({ liked: z.boolean() }).parse(other.data).liked, false);
	});

	after(() => db().dropDatabase());
});

describe("Game API — my-boardgames liked-first ordering (#117)", () => {
	let alice: Awaited<ReturnType<typeof insertUserWithAuth>>;

	before(async () => {
		alice = await insertUserWithAuth("carol");
		for (const game of gameNames) {
			await colls.gameInfos.insertOne({
				_id: { game, version: 1 },
				viewer: { url: `//test.com/${game}` },
				meta: { public: true },
			});
			await colls.gameMetadatas.insertOne({ _id: game, label: game, players: [2] });
		}
		// Play history: likegame-b most recent, then likegame-c, then likegame-a.
		const base = Date.now();
		const history: [string, number][] = [
			["likegame-a", base - 3000],
			["likegame-c", base - 2000],
			["likegame-b", base - 1000],
		];
		for (const [game, time] of history) {
			await colls.games.insertOne({
				_id: `${game}-1`,
				game: { name: game, version: 1, expansions: [] },
				status: "active",
				ready: true,
				cancelled: false,
				creator: alice.userId,
				data: null,
				context: { round: 1 },
				players: [
					{ _id: alice.userId, remainingTime: 0, dropped: false, quit: false, score: 0, name: "alice" },
					{ _id: new ObjectId(), remainingTime: 0, dropped: false, quit: false, score: 0, name: "bot", isBot: true },
				],
				options: {
					setup: { seed: "test", nbPlayers: 2, playerOrder: "random" },
					timing: { timePerGame: 5000, timePerMove: 5000, timer: { start: 0, end: 86400 } },
					meta: { unlisted: false },
				},
				lastMove: new Date(time),
				createdAt: new Date(time),
				updatedAt: new Date(time),
			});
		}
	});

	it("orders by recency when nothing is liked", async () => {
		const res = await api(
			"GET",
			`/api/game/my-boardgames?user=${alice.userId.toHexString()}`,
			undefined,
			alice.authHeaders,
		);
		assert.strictEqual(res.status, 200);
		const rows = z.array(z.object({ boardgame: z.string(), liked: z.boolean().optional() })).parse(res.data);
		assert.deepStrictEqual(
			rows.map((r) => r.boardgame),
			["likegame-b", "likegame-c", "likegame-a"],
		);
	});

	it("boosts liked games (like time counts as activity)", async () => {
		// Distinct like times (past, but after the seeded play history) make the
		// ordering assertion deterministic: a liked more recently than b, both
		// outranking the play history (b liked > played, c never liked).
		const base = Date.now() - 1500;
		await colls.gameLikes.insertOne({ game: "likegame-b", user: alice.userId, createdAt: new Date(base) });
		await colls.gameLikes.insertOne({ game: "likegame-a", user: alice.userId, createdAt: new Date(base + 1000) });

		const res = await api(
			"GET",
			`/api/game/my-boardgames?user=${alice.userId.toHexString()}`,
			undefined,
			alice.authHeaders,
		);
		const rows = z.array(z.object({ boardgame: z.string(), liked: z.boolean().optional() })).parse(res.data);
		assert.deepStrictEqual(
			rows.map((r) => r.boardgame),
			["likegame-a", "likegame-b", "likegame-c"],
		);
		assert.deepStrictEqual(
			rows.map((r) => r.liked ?? false),
			[true, true, false],
		);
	});

	it("surfaces a liked game never played", async () => {
		await colls.gameInfos.insertOne({
			_id: { game: "likegame-fresh", version: 1 },
			viewer: { url: "//test.com/likegame-fresh" },
			meta: { public: true },
		});
		await colls.gameMetadatas.insertOne({ _id: "likegame-fresh", label: "likegame-fresh", players: [2] });
		// Fresh like (now) outranks the suite's older likes/play history.
		await colls.gameLikes.insertOne({ game: "likegame-fresh", user: alice.userId, createdAt: new Date() });

		const res = await api(
			"GET",
			`/api/game/my-boardgames?user=${alice.userId.toHexString()}`,
			undefined,
			alice.authHeaders,
		);
		const rows = z.array(z.object({ boardgame: z.string(), liked: z.boolean().optional() })).parse(res.data);
		assert.strictEqual(rows[0]?.boardgame, "likegame-fresh");
		assert.strictEqual(rows[0]?.liked, true);
	});

	after(() => db().dropDatabase());
});
