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
import { ACTION_RATE_LIMITS } from "../../services/actionratelimit.ts";

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
			account: { username: `requser${suffix}`, email: `requser${suffix}@test.com` },
			security: { confirmed: true, slug: `requser${suffix}` },
		}),
	);
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { userId, authHeaders: { Authorization: `Bearer ${token}` } };
}

const requestListItem = z.object({
	_id: z.string(),
	label: z.string(),
	description: z.string().optional(),
	likeCount: z.number(),
	liked: z.boolean(),
	requestedBy: z.string().optional(),
	createdAt: z.string().optional(),
});

describe("Boardgame API — game requests (#340)", () => {
	let alice: Awaited<ReturnType<typeof insertUserWithAuth>>;
	let bob: Awaited<ReturnType<typeof insertUserWithAuth>>;

	before(async () => {
		// One implemented game: requests must not collide with it, and it anchors
		// the "requested games stay out of the regular list" assertions.
		await colls.gameInfos.insertOne({
			_id: { game: "implemented-game", version: 1 },
			viewer: { url: "//test.com/implemented-game" },
			public: true,
		});
		// The label slugifies to the game id ("Implemented Game" → "implemented-game").
		await colls.gameMetadatas.insertOne({ _id: "implemented-game", label: "Implemented Game", players: [2] });
		alice = await insertUserWithAuth("alice");
		bob = await insertUserWithAuth("bob");
	});

	it("requires authentication to create a request", async () => {
		assert.strictEqual((await api("POST", "/api/boardgame/request", { label: "Anon Game" })).status, 401);
	});

	it("creates a game request, auto-liked by the requester", async () => {
		const res = await api(
			"POST",
			"/api/boardgame/request",
			{ label: "Requested Game One", description: "A great game" },
			alice.authHeaders,
		);
		assert.strictEqual(res.status, 201);
		const created = requestListItem.parse(res.data);
		assert.strictEqual(created._id, "requested-game-one");
		assert.strictEqual(created.label, "Requested Game One");
		assert.strictEqual(created.description, "A great game");
		assert.strictEqual(created.likeCount, 1);
		assert.strictEqual(created.liked, true);

		const doc = await colls.gameMetadatas.findOne({ _id: "requested-game-one" });
		assert.strictEqual(doc?.status, "requested");
		assert.deepStrictEqual(doc?.players, []);
		assert.strictEqual(doc?.requestedBy?.toHexString(), alice.userId.toHexString());
		assert.strictEqual(await colls.gameLikes.countDocuments({ game: "requested-game-one", user: alice.userId }), 1);
	});

	it("rejects a label that is already requested", async () => {
		const res = await api("POST", "/api/boardgame/request", { label: "Requested Game One" }, bob.authHeaders);
		assert.strictEqual(res.status, 409);
	});

	it("rejects a label that is already an implemented game", async () => {
		const res = await api("POST", "/api/boardgame/request", { label: "Implemented Game" }, bob.authHeaders);
		assert.strictEqual(res.status, 409);
	});

	it("validates the label", async () => {
		assert.strictEqual((await api("POST", "/api/boardgame/request", { label: "x" }, alice.authHeaders)).status, 400);
		assert.strictEqual((await api("POST", "/api/boardgame/request", { label: "!!!" }, alice.authHeaders)).status, 400);
		assert.strictEqual((await api("POST", "/api/boardgame/request", {}, alice.authHeaders)).status, 400);
	});

	it("votes on a requested game through the regular like endpoints", async () => {
		const res = await api("POST", "/api/boardgame/requested-game-one/like", undefined, bob.authHeaders);
		assert.strictEqual(res.status, 200);
		assert.deepStrictEqual(res.data, { liked: true, likeCount: 2 });

		const again = await api("DELETE", "/api/boardgame/requested-game-one/like", undefined, bob.authHeaders);
		assert.deepStrictEqual(again.data, { liked: false, likeCount: 1 });
		// Restore bob's vote for the ordering assertions below.
		await api("POST", "/api/boardgame/requested-game-one/like", undefined, bob.authHeaders);
	});

	it("lists requested games, most-liked first, with per-user liked flags", async () => {
		// A second request (1 like) ranks below "requested-game-one" (2 likes).
		await api("POST", "/api/boardgame/request", { label: "Requested Game Two" }, bob.authHeaders);

		// Filter to this suite's fixtures: the DB may hold other specs' requests.
		const anonymous = z
			.array(requestListItem)
			.parse((await api("GET", "/api/boardgame/requests")).data)
			.filter((r) => r._id.startsWith("requested-game-"));
		assert.deepStrictEqual(
			anonymous.map((r) => r._id),
			["requested-game-one", "requested-game-two"],
		);
		assert.deepStrictEqual(
			anonymous.map((r) => r.likeCount),
			[2, 1],
		);
		assert.deepStrictEqual(
			anonymous.map((r) => r.liked),
			[false, false],
		);
		assert.strictEqual(anonymous[0].requestedBy, "requseralice");

		const authed = z
			.array(requestListItem)
			.parse((await api("GET", "/api/boardgame/requests", undefined, alice.authHeaders)).data)
			.filter((r) => r._id.startsWith("requested-game-"));
		assert.deepStrictEqual(
			authed.map((r) => r.liked),
			[true, false],
		);
	});

	it("keeps requested games out of the regular game-info list", async () => {
		const list = z
			.array(z.object({ _id: z.object({ game: z.string(), version: z.number() }) }))
			.parse((await api("GET", "/api/boardgame/info")).data);
		const games = list.map((i) => i._id.game);
		assert.ok(games.includes("implemented-game"));
		assert.ok(!games.includes("requested-game-one"));
		assert.ok(!games.includes("requested-game-two"));
	});

	it("404s requested games on the game-info / like-param routes (they are not playable)", async () => {
		assert.strictEqual((await api("GET", "/api/boardgame/requested-game-one")).status, 404);
		assert.strictEqual((await api("GET", "/api/boardgame/requested-game-one/info")).status, 404);
	});

	it("keeps requested games out of the sidebar's my-boardgames (liked but not playable)", async () => {
		const res = await api(
			"GET",
			`/api/game/my-boardgames?user=${alice.userId.toHexString()}`,
			undefined,
			alice.authHeaders,
		);
		assert.strictEqual(res.status, 200);
		const rows = z.array(z.object({ boardgame: z.string() })).parse(res.data);
		assert.ok(!rows.some((r) => r.boardgame === "requested-game-one"));
	});

	it("keeps requested games out of the profile's liked-games", async () => {
		await api("POST", "/api/boardgame/implemented-game/like", undefined, alice.authHeaders);
		const res = await api("GET", `/api/user/${alice.userId.toHexString()}/liked-games`);
		assert.strictEqual(res.status, 200);
		const rows = z.array(z.object({ game: z.string() })).parse(res.data);
		assert.deepStrictEqual(
			rows.map((r) => r.game),
			["implemented-game"],
		);
	});

	it("caps the number of open requests per user", async () => {
		// Relax the per-day action rate limit (registered at 10/day, which this test
		// would otherwise trip) so only the open-requests cap is exercised.
		ACTION_RATE_LIMITS["boardgame/request"] = { max: 1000, windowMs: 24 * 60 * 60 * 1000 };
		try {
			// Alice already has 1 open request ("requested-game-one"); create 9 more.
			for (let i = 1; i <= 9; i++) {
				const res = await api("POST", "/api/boardgame/request", { label: `Alice Bulk Game ${i}` }, alice.authHeaders);
				assert.strictEqual(res.status, 201, `request ${i}: ${JSON.stringify(res.data)}`);
			}
			const res = await api("POST", "/api/boardgame/request", { label: "One Request Too Many" }, alice.authHeaders);
			assert.strictEqual(res.status, 429);
			// Bob (2 open requests) is unaffected by alice's cap.
			assert.strictEqual(
				(await api("POST", "/api/boardgame/request", { label: "Bob Extra Game" }, bob.authHeaders)).status,
				201,
			);
		} finally {
			ACTION_RATE_LIMITS["boardgame/request"] = { max: 10, windowMs: 24 * 60 * 60 * 1000 };
		}
	});

	after(() => db().dropDatabase());
});
