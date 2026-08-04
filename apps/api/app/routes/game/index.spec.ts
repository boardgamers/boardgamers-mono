// Run via `pnpm test` (the package.json script), NOT bare `node --test`. The script
// imports app/config/test-hooks.ts, which connects to the *-test database and starts
// the API server. Running this file directly leaves `colls` uninitialized →
// "Cannot read properties of undefined (reading 'insertOne')".
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { db } from "../../config/db.ts";
import env from "../../config/env.ts";
import { colls } from "../../config/db.ts";
import { testUser, testGame, testGamePrefs } from "../../config/test-helpers.ts";
import { createAccessToken, generateRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

const newGameBody = (gameId: string) => ({
	gameId,
	game: { game: "test", version: 1 },
	timePerMove: 5000,
	timePerGame: 5000,
	players: 2,
	options: { join: true },
});

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

function errorMessage(data: unknown): string | undefined {
	if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
		return data.message;
	}
	return undefined;
}

describe("Game API", () => {
	const userId = new ObjectId();
	let authHeaders: Record<string, string> = {};

	before(async () => {
		await colls.users.insertOne(
			testUser({ _id: userId, account: { username: "test", email: "test@test.com" }, security: { confirmed: true } }),
		);
		await colls.gameInfos.insertOne({
			_id: { game: "test", version: 1 },
			label: "Test",
			viewer: { url: "//test.com/test", topLevelVariable: "test" },
			players: [2],
			meta: { public: true, needOwnership: true },
		});
		const code = generateRefreshCode();
		const tokenDoc = { user: userId, code, createdAt: new Date() };
		await colls.jwtRefreshTokens.insertOne(tokenDoc);
		const token = await createAccessToken(tokenDoc, ["all"], false);
		authHeaders = { Authorization: `Bearer ${token}` };
	});

	it("should not be able to create a game without ownership", async () => {
		const res = await api(
			"POST",
			"/api/game/new-game",
			{
				gameId: "test",
				game: { game: "test", version: 1 },
				timePerMove: 5000,
				timePerGame: 5000,
				players: 2,
				options: { join: true },
			},
			authHeaders,
		);

		assert.strictEqual(res.ok, false);
		assert.ok(errorMessage(res.data)?.includes("own the game"));
	});

	it("should be able to create a game with ownership", async () => {
		await colls.gamePreferences.insertOne(testGamePrefs({ user: userId, game: "test", access: { ownership: true } }));

		const res = await api(
			"POST",
			"/api/game/new-game",
			{
				gameId: "test",
				game: { game: "test", version: 1 },
				timePerMove: 5000,
				timePerGame: 5000,
				players: 2,
				options: { join: true },
			},
			authHeaders,
		);

		assert.strictEqual(res.ok, true);
	});

	it("should create a game when seed is an empty string and fall back to the gameId", async () => {
		// The web client always sends `seed: ""` when the Custom Seed box is untouched.
		// That must pass the schema (regression for the zod migration) and flow into the
		// existing `body.seed || gameId` fallback rather than 400ing.
		const res = await api(
			"POST",
			"/api/game/new-game",
			{
				gameId: "test-seed",
				game: { game: "test", version: 1 },
				timePerMove: 5000,
				timePerGame: 5000,
				players: 2,
				options: { join: true },
				seed: "",
			},
			authHeaders,
		);

		assert.strictEqual(res.ok, true);
		const game = await colls.games.findOne({ _id: "test-seed" });
		assert.ok(game, "Game should be created");
		assert.strictEqual(game.options.setup.seed, "test-seed", "Empty seed should fall back to the gameId");
	});

	it("should not be able to create a game with the wrong number of players", async () => {
		const res = await api(
			"POST",
			"/api/game/new-game",
			{
				gameId: "test-fail",
				game: { game: "test", version: 1 },
				timePerMove: 5000,
				timePerGame: 5000,
				players: 3,
				options: { join: true },
			},
			authHeaders,
		);

		assert.strictEqual(res.ok, false);
		assert.strictEqual(errorMessage(res.data), "Wrong number of players");
	});

	describe("open-games cap", () => {
		const capUserId = new ObjectId();
		let capAuthHeaders: Record<string, string> = {};

		before(async () => {
			await colls.users.insertOne(
				testUser({
					_id: capUserId,
					account: { username: "capped", email: "capped@test.com" },
					security: { confirmed: true },
				}),
			);
			await colls.gamePreferences.insertOne(
				testGamePrefs({ user: capUserId, game: "test", access: { ownership: true } }),
			);
			const code = generateRefreshCode();
			const tokenDoc = { user: capUserId, code, createdAt: new Date() };
			await colls.jwtRefreshTokens.insertOne(tokenDoc);
			const token = await createAccessToken(tokenDoc, ["all"], false);
			capAuthHeaders = { Authorization: `Bearer ${token}` };
		});

		it("should reject creating a game when the open-games cap is reached", async () => {
			const cap = env.maxOpenGamesPerUser;
			assert.ok(cap > 0, "The open-games cap must be enabled for this test");
			// Two non-counted fixtures: cancelled and active games must not count towards the cap.
			await colls.games.insertMany([
				testGame({ _id: "cap-cancelled", creator: capUserId, cancelled: true, game: { name: "test", version: 1 } }),
				testGame({ _id: "cap-active", creator: capUserId, status: "active", game: { name: "test", version: 1 } }),
				...Array.from({ length: cap }, (_, i) =>
					testGame({ _id: `cap-open-${i}`, creator: capUserId, game: { name: "test", version: 1 } }),
				),
			]);

			const res = await api("POST", "/api/game/new-game", newGameBody("test-capped"), capAuthHeaders);

			assert.strictEqual(res.status, 422);
			assert.ok(errorMessage(res.data)?.includes(`${cap} open games`), `Unexpected message: ${errorMessage(res.data)}`);
		});

		it("should count unlisted games towards the open-games cap", async () => {
			await colls.games.deleteMany({ _id: "cap-open-0" });
			await colls.games.insertOne(
				testGame({
					_id: "cap-unlisted",
					creator: capUserId,
					options: {
						setup: { seed: "test", nbPlayers: 2, playerOrder: "random" },
						timing: { timePerGame: 5000, timePerMove: 5000, timer: { start: 0, end: 86400 } },
						meta: { unlisted: true },
					},
					game: { name: "test", version: 1 },
				}),
			);

			const res = await api("POST", "/api/game/new-game", newGameBody("test-capped-unlisted"), capAuthHeaders);

			assert.strictEqual(res.status, 422);
		});

		it("should allow creating a game below the open-games cap", async () => {
			// Back to cap - 1 open games created by the user.
			await colls.games.deleteMany({ _id: { $in: ["cap-unlisted", "cap-open-0"] } });

			const res = await api("POST", "/api/game/new-game", newGameBody("test-below-cap"), capAuthHeaders);

			assert.strictEqual(res.ok, true, `Unexpected response: ${JSON.stringify(res.data)}`);
		});
	});

	it("should be able to leave the game", async () => {
		const res = await api("POST", "/api/game/test/unjoin", {}, authHeaders);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(
			await colls.games.countDocuments({ _id: "test" }),
			0,
			"Game should be deleted after creator unjoins",
		);
	});

	it("should record the game id in the error meta for game-scoped routes", async () => {
		await colls.games.insertOne(
			testGame({
				_id: "meta-game",
				creator: userId,
				status: "active",
				players: [{ _id: new ObjectId(), name: "someone-else" }],
				game: { name: "test", version: 1 },
			}),
		);
		await colls.apiErrors.deleteMany({});
		// The chat route requires being a player of the game — the assert error (422)
		// should be recorded with the game's id in its meta.
		const res = await api("POST", "/api/game/meta-game/chat", { type: "text", data: { text: "hello" } }, authHeaders);

		assert.strictEqual(res.status, 422);
		const apiError = await colls.apiErrors.findOne({ "request.url": "/api/game/meta-game/chat" });
		assert.ok(apiError, "The error should be recorded");
		assert.strictEqual((apiError.meta as { gameId?: string }).gameId, "meta-game");
	});

	after(() => db().dropDatabase());
});
