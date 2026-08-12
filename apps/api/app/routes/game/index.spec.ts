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
import { createAccessToken, generateRefreshCode, hashRefreshCode } from "../../models/jwtrefreshtokens.ts";

const baseURL = () => `http://${env.listen.host}:${env.listen.port.api}`;

const newGameBody = (gameId: string, extra: Record<string, unknown> = {}) => ({
	gameId,
	game: { game: "test", version: 1 },
	timePerMove: 5000,
	timePerGame: 5000,
	players: 2,
	options: { join: true },
	...extra,
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

async function makeAuthHeaders(userId: ObjectId) {
	const code = generateRefreshCode();
	const tokenDoc = { user: userId, codeHash: hashRefreshCode(code), createdAt: new Date() };
	await colls.jwtRefreshTokens.insertOne(tokenDoc);
	const token = await createAccessToken(tokenDoc, ["all"], false);
	return { Authorization: `Bearer ${token}` };
}

describe("Game API", () => {
	const userId = new ObjectId();
	const joinerId = new ObjectId();
	const joiner2Id = new ObjectId();
	const joiner3Id = new ObjectId();
	let authHeaders: Record<string, string> = {};
	let joinerAuthHeaders: Record<string, string> = {};
	let joiner2AuthHeaders: Record<string, string> = {};
	let joiner3AuthHeaders: Record<string, string> = {};

	before(async () => {
		await colls.users.insertOne(
			testUser({ _id: userId, account: { username: "test", email: "test@test.com" }, security: { confirmed: true } }),
		);
		await colls.users.insertOne(
			testUser({
				_id: joinerId,
				account: { username: "joiner", email: "joiner@test.com", karma: 80 },
				security: { confirmed: true },
			}),
		);
		await colls.users.insertOne(
			testUser({
				_id: joiner2Id,
				account: { username: "joiner2", email: "joiner2@test.com", karma: 80 },
				security: { confirmed: true },
			}),
		);
		await colls.gamePreferences.insertOne(
			testGamePrefs({ user: joinerId, game: "test", elo: { value: 400, games: 5 } }),
		);
		await colls.gamePreferences.insertOne(
			testGamePrefs({ user: joiner2Id, game: "test", elo: { value: 200, games: 5 } }),
		);
		await colls.users.insertOne(
			testUser({
				_id: joiner3Id,
				account: { username: "joiner3", email: "joiner3@test.com", karma: 80 },
				security: { confirmed: true },
			}),
		);
		await colls.gameInfos.insertOne({
			_id: { game: "test", version: 1 },
			label: "Test",
			viewer: { url: "//test.com/test", topLevelVariable: "test" },
			players: [2],
			meta: { public: true, needOwnership: true },
		});
		await colls.gameInfos.insertOne({
			_id: { game: "test3", version: 1 },
			label: "Test 3P",
			viewer: { url: "//test.com/test3", topLevelVariable: "test3" },
			players: [2, 3],
			meta: { public: true, needOwnership: true },
		});
		authHeaders = await makeAuthHeaders(userId);
		joinerAuthHeaders = await makeAuthHeaders(joinerId);
		joiner2AuthHeaders = await makeAuthHeaders(joiner2Id);
		joiner3AuthHeaders = await makeAuthHeaders(joiner3Id);
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

	it("should reject an empty-string seed (frontend omits seed instead)", async () => {
		const res = await api(
			"POST",
			"/api/game/new-game",
			{
				gameId: "test-seed-empty",
				game: { game: "test", version: 1 },
				timePerMove: 5000,
				timePerGame: 5000,
				players: 2,
				options: { join: true },
				seed: "",
			},
			authHeaders,
		);

		assert.strictEqual(res.ok, false);
		assert.strictEqual(await colls.games.countDocuments({ _id: "test-seed-empty" }), 0);
	});

	it("should create a game without seed and fall back to the gameId", async () => {
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
			},
			authHeaders,
		);

		assert.strictEqual(res.ok, true);
		const game = await colls.games.findOne({ _id: "test-seed" });
		assert.ok(game, "Game should be created");
		assert.strictEqual(game.options.setup.seed, "test-seed", "Missing seed should fall back to the gameId");
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

	describe("bot players", () => {
		it("should reject bots for a game that does not support them", async () => {
			const res = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-unsupported", { bots: 1 }),
				authHeaders,
			);

			assert.strictEqual(res.ok, false);
			assert.ok(errorMessage(res.data)?.includes("does not support bot players"));
			assert.strictEqual(await colls.games.countDocuments({ _id: "test-bots-unsupported" }), 0);
		});

		it("should reject a game with no human player", async () => {
			await colls.gameInfos.updateOne({ _id: { game: "test", version: 1 } }, { $set: { "meta.bots": true } });

			const res = await api("POST", "/api/game/new-game", newGameBody("test-bots-all", { bots: 2 }), authHeaders);

			assert.strictEqual(res.ok, false);
			assert.ok(errorMessage(res.data)?.includes("at least one human player"));
			assert.strictEqual(await colls.games.countDocuments({ _id: "test-bots-all" }), 0);
		});

		it("should create a game with bot players filling seats", async () => {
			const res = await api("POST", "/api/game/new-game", newGameBody("test-bots", { bots: 1 }), authHeaders);

			assert.strictEqual(res.ok, true, JSON.stringify(res.data));
			const game = await colls.games.findOne({ _id: "test-bots" });
			assert.ok(game, "Game should be created");
			assert.strictEqual(game.players.length, 2, "Creator + bot fill both seats");
			const bot = game.players.find((pl) => pl.isBot);
			assert.ok(bot, "One player should be flagged as bot");
			assert.ok(bot.name.includes("bot"), "Bot name should be labeled");
			assert.ok(
				game.players.some((pl) => pl._id.equals(userId) && !pl.isBot),
				"Creator is a human player",
			);
			assert.strictEqual(game.options.setup.nbPlayers, 2);

			// The players endpoint surfaces bots (they have no user document).
			const playersRes = await api("GET", "/api/game/test-bots/players", undefined, authHeaders);
			assert.strictEqual(playersRes.ok, true);
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- response body is untyped JSON
			const listed = playersRes.data as { _id: string; name: string }[];
			assert.ok(
				listed.some((pl) => pl._id === bot._id.toString() && pl.name === bot.name),
				"Bot should be listed in /players",
			);
		});

		it("should count the bot seats when a human joins", async () => {
			const createRes = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-join", { bots: 1 }),
				authHeaders,
			);
			assert.strictEqual(createRes.ok, true, JSON.stringify(createRes.data));

			const game = await colls.games.findOne({ _id: "test-bots-join" });
			assert.strictEqual(game?.players.length, 2, "Creator + 1 bot — the game is already full");

			const joinRes = await api("POST", "/api/game/test-bots-join/join", {}, joinerAuthHeaders);
			assert.strictEqual(joinRes.ok, false, "No free seat left for another human");
			assert.ok(errorMessage(joinRes.data)?.includes("Too many people"));
		});
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
			const tokenDoc = { user: capUserId, codeHash: hashRefreshCode(code), createdAt: new Date() };
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

		describe("elo range", () => {
			before(async () => {
				await colls.gamePreferences.updateOne(
					{ user: userId, game: "test" },
					{ $set: { elo: { value: 150, games: 10 } } },
				);
				await colls.gamePreferences.insertOne(
					testGamePrefs({ user: userId, game: "test3", access: { ownership: true }, elo: { value: 150, games: 10 } }),
				);
			});

			it("should not create a game with an elo range narrower than 100", async () => {
				const res = await api(
					"POST",
					"/api/game/new-game",
					newGameBody("test-elo-narrow", { eloRange: { min: 100, max: 150 } }),
					authHeaders,
				);

				assert.strictEqual(res.status, 422);
				assert.strictEqual(errorMessage(res.data), "The Elo range must be at least 100 wide");
			});

			it("should not create a game when the creator's elo is outside the range", async () => {
				const res = await api(
					"POST",
					"/api/game/new-game",
					newGameBody("test-elo-creator", { eloRange: { min: 200, max: 300 } }),
					authHeaders,
				);

				assert.strictEqual(res.status, 422);
				assert.ok(errorMessage(res.data)?.includes("must be within the game's Elo range"));
			});

			it("should create a game with an elo range including the creator's elo", async () => {
				const res = await api(
					"POST",
					"/api/game/new-game",
					newGameBody("test-elo-ok", { eloRange: { min: 100, max: 300 } }),
					authHeaders,
				);

				assert.strictEqual(res.ok, true);
				const game = await colls.games.findOne({ _id: "test-elo-ok" });
				assert.deepStrictEqual(game?.options.meta?.eloRange, { min: 100, max: 300 });
			});

			it("should not let a player with elo outside the range join", async () => {
				const res = await api("POST", "/api/game/test-elo-ok/join", {}, joinerAuthHeaders);

				assert.strictEqual(res.status, 422);
				assert.ok(errorMessage(res.data)?.includes("outside this game's Elo range"));
			});

			it("should let a player with elo inside the range join", async () => {
				const res = await api("POST", "/api/game/test-elo-ok/join", {}, joiner2AuthHeaders);

				assert.strictEqual(res.ok, true, JSON.stringify(res.data));
				const game = await colls.games.findOne({ _id: "test-elo-ok" });
				assert.ok(
					game?.players.some((pl) => pl._id.equals(joiner2Id)),
					"Joiner should be in the player list",
				);
			});

			it("should treat an unrated player as elo 0", async () => {
				const createRes = await api(
					"POST",
					"/api/game/new-game",
					newGameBody("test-elo-unrated", {
						game: { game: "test3", version: 1 },
						players: 3,
						options: { join: false },
						eloRange: { min: 100, max: 300 },
					}),
					authHeaders,
				);
				assert.strictEqual(createRes.ok, true);

				const res = await api("POST", "/api/game/test-elo-unrated/join", {}, joiner3AuthHeaders);

				assert.strictEqual(res.status, 422);
				assert.ok(errorMessage(res.data)?.includes("Your Elo (0)"));
			});
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
