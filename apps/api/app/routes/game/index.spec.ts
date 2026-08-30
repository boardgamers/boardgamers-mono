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
import locks from "../../config/locks.ts";
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
			viewer: { url: "//test.com/test", topLevelVariable: "test" },
			public: true,
			meta: {},
		});
		// Game-level fields (label/players/needOwnership) live on the metadata doc (#298).
		await colls.gameMetadatas.insertOne({ _id: "test", label: "Test", players: [2], needOwnership: true });
		await colls.gameInfos.insertOne({
			_id: { game: "test3", version: 1 },
			viewer: { url: "//test.com/test3", topLevelVariable: "test3" },
			public: true,
			meta: { bots: true },
		});
		await colls.gameMetadatas.insertOne({ _id: "test3", label: "Test 3P", players: [2, 3], needOwnership: true });
		await colls.gamePreferences.insertOne(
			testGamePrefs({ user: userId, game: "test3", access: { ownership: true }, elo: { value: 150, games: 10 } }),
		);
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

	it("should expose public player info (karma, no private fields) on /players", async () => {
		const createRes = await api("POST", "/api/game/new-game", newGameBody("test-playerinfo"), authHeaders);
		assert.strictEqual(createRes.ok, true, JSON.stringify(createRes.data));
		const joinRes = await api("POST", "/api/game/test-playerinfo/join", {}, joinerAuthHeaders);
		assert.strictEqual(joinRes.ok, true, JSON.stringify(joinRes.data));

		const res = await api("GET", "/api/game/test-playerinfo/players", undefined, authHeaders);
		assert.strictEqual(res.ok, true);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- response body is untyped JSON
		const players = res.data as Record<string, unknown>[];
		const joiner = players.find((pl) => pl.name === "joiner");
		assert.ok(joiner, "Joiner should be listed");
		assert.strictEqual(joiner.karma, 80, "Karma is exposed");
		assert.strictEqual(typeof joiner.elo, "number", "Elo is exposed");
		// Only public fields — never email/security/private.
		assert.strictEqual(joiner.email, undefined);
		assert.strictEqual(joiner.security, undefined);
		assert.strictEqual(joiner.account, undefined);
	});

	it("should store an optional creator description and reject an over-long one", async () => {
		const description = "Casual game, **beginners welcome**! <script>alert(1)</script>";
		const createRes = await api(
			"POST",
			"/api/game/new-game",
			newGameBody("test-description", { description }),
			authHeaders,
		);
		assert.strictEqual(createRes.ok, true, JSON.stringify(createRes.data));

		const res = await api("GET", "/api/game/test-description", undefined, authHeaders);
		assert.strictEqual(res.ok, true);
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- response body is untyped JSON
		const game = res.data as Record<string, unknown>;
		// Stored verbatim (markdown source); sanitizing happens at render time.
		assert.strictEqual(game.description, description);

		const tooLong = await api(
			"POST",
			"/api/game/new-game",
			newGameBody("test-description-long", { description: "x".repeat(1001) }),
			authHeaders,
		);
		assert.strictEqual(tooLong.ok, false, "Over-long description is rejected");
		assert.strictEqual(await colls.games.countDocuments({ _id: "test-description-long" }), 0);

		const noDesc = await api("POST", "/api/game/new-game", newGameBody("test-no-description"), authHeaders);
		assert.strictEqual(noDesc.ok, true, JSON.stringify(noDesc.data));
		const noDescGame = await colls.games.findOne({ _id: "test-no-description" });
		assert.strictEqual(noDescGame?.description, undefined, "Description stays absent when not provided");
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

		it("should reject bots filling every seat when the creator does not join", async () => {
			// bots == players - 1 is fine when the creator joins (they are the human), but
			// without `join` the last seat stays open for no one — an all-bot game.
			const res = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-all-nocreator", { bots: 1, options: {} }),
				authHeaders,
			);

			assert.strictEqual(res.ok, false);
			assert.ok(errorMessage(res.data)?.includes("at least one human player"));
			assert.strictEqual(await colls.games.countDocuments({ _id: "test-bots-all-nocreator" }), 0);

			// Same setup with the creator joining IS valid: they are the human player.
			const okRes = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-one-human", { bots: 1, options: { join: true } }),
				authHeaders,
			);
			assert.strictEqual(okRes.ok, true, JSON.stringify(okRes.data));
			await colls.games.deleteOne({ _id: "test-bots-one-human" });
		});

		it("should start the game when an invited player fills the last seat left by bots", async () => {
			const createRes = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-invite", {
					game: { game: "test3", version: 1 },
					players: 3,
					bots: 1,
					options: { join: true },
				}),
				authHeaders,
			);
			assert.strictEqual(createRes.ok, true, JSON.stringify(createRes.data));

			const inviteeId = new ObjectId();
			await colls.users.insertOne(
				testUser({
					_id: inviteeId,
					account: { username: "invitee", email: "invitee@test.com", karma: 80 },
					security: { confirmed: true },
				}),
			);
			const inviteeAuth = await makeAuthHeaders(inviteeId);

			const inviteRes = await api("POST", "/api/game/test-bots-invite/invite", { userId: inviteeId }, authHeaders);
			assert.strictEqual(inviteRes.ok, true, JSON.stringify(inviteRes.data));

			const joinRes = await api("POST", "/api/game/test-bots-invite/join", {}, inviteeAuth);
			assert.strictEqual(joinRes.ok, true, JSON.stringify(joinRes.data));

			const game = await colls.games.findOne({ _id: "test-bots-invite" });
			assert.strictEqual(game?.players.length, 3, "Creator + bot + invited player");
			assert.strictEqual(game?.ready, true, "Accepting the last invite starts the game");
			assert.strictEqual(
				await colls.gameNotifications.countDocuments({ game: "test-bots-invite", kind: "gameStarted" }),
				1,
			);
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
			assert.strictEqual(game.ready, true, "Creator + bot fill both seats — the game starts immediately");
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
			assert.strictEqual(game?.ready, true, "Full at creation — already starting");

			const joinRes = await api("POST", "/api/game/test-bots-join/join", {}, joinerAuthHeaders);
			assert.strictEqual(joinRes.ok, false, "No free seat left for another human");
			assert.strictEqual(errorMessage(joinRes.data), "Game is starting");
		});

		it("should reject joining a full game marked ready before its last seat was filled", async () => {
			// Legacy room: a full game that was already marked ready (e.g. by the host
			// picking setup options with playerOrder "host") must reject new joins even
			// though "Too many people" would also match — the ready check comes first.
			const createRes = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-join2", { bots: 1, options: { join: true, playerOrder: "host" } }),
				authHeaders,
			);
			assert.strictEqual(createRes.ok, true, JSON.stringify(createRes.data));

			const startRes = await api("POST", "/api/game/test-bots-join2/start", {}, authHeaders);
			assert.strictEqual(startRes.ok, true, JSON.stringify(startRes.data));
			assert.strictEqual((await colls.games.findOne({ _id: "test-bots-join2" }))?.ready, true);

			const joinRes = await api("POST", "/api/game/test-bots-join2/join", {}, joinerAuthHeaders);
			assert.strictEqual(joinRes.ok, false);
			assert.strictEqual(errorMessage(joinRes.data), "Game is starting");
		});

		it("should mark a game full at creation as ready and emit gameStarted", async () => {
			// Shed the creator's earlier open bot games (they became ready at creation and
			// still count towards the open-games cap).
			await colls.games.deleteMany({ _id: { $in: ["test-bots", "test-bots-join", "test-bots-join2"] } });
			const res = await api("POST", "/api/game/new-game", newGameBody("test-bots-full", { bots: 1 }), authHeaders);

			assert.strictEqual(res.ok, true, JSON.stringify(res.data));
			const game = await colls.games.findOne({ _id: "test-bots-full" });
			assert.ok(game, "Game should be created");
			assert.strictEqual(game.players.length, 2, "Creator + bot fill both seats");
			assert.strictEqual(game.ready, true, "A game full at creation is ready, like after the last join");

			const notif = await colls.gameNotifications.findOne({ game: "test-bots-full", kind: "gameStarted" });
			assert.ok(notif, "gameStarted notification emitted so the game-server starts the game");

			const chatMsg = await colls.chatMessages.findOne({ room: "test-bots-full", type: "system" });
			assert.strictEqual(chatMsg?.data.text, "Game started");
		});

		it("should keep a bot game with free seats open (starts via join)", async () => {
			const res = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-notfull", {
					game: { game: "test3", version: 1 },
					players: 3,
					bots: 1,
				}),
				authHeaders,
			);

			assert.strictEqual(res.ok, true, JSON.stringify(res.data));
			const game = await colls.games.findOne({ _id: "test-bots-notfull" });
			assert.ok(game, "Game should be created");
			assert.strictEqual(game.players.length, 2, "Creator + bot, one seat still free");
			assert.strictEqual(game.ready, false, "Game stays open, waiting for a human to join");
			assert.strictEqual(
				await colls.gameNotifications.countDocuments({ game: "test-bots-notfull", kind: "gameStarted" }),
				0,
				"No gameStarted notification yet",
			);

			const joinRes = await api("POST", "/api/game/test-bots-notfull/join", {}, joinerAuthHeaders);
			assert.strictEqual(joinRes.ok, true, JSON.stringify(joinRes.data));
			const joined = await colls.games.findOne({ _id: "test-bots-notfull" });
			assert.strictEqual(joined?.ready, true, "The last human joining triggers the start, as before");
			assert.strictEqual(
				await colls.gameNotifications.countDocuments({ game: "test-bots-notfull", kind: "gameStarted" }),
				1,
			);
		});

		it('should wait for the host when a full-at-creation game has playerOrder "host"', async () => {
			const res = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-host", { bots: 1, options: { join: true, playerOrder: "host" } }),
				authHeaders,
			);

			assert.strictEqual(res.ok, true, JSON.stringify(res.data));
			const game = await colls.games.findOne({ _id: "test-bots-host" });
			assert.ok(game, "Game should be created");
			assert.strictEqual(game.ready, false, "Host still has to pick setup options");
			assert.ok(
				game.currentPlayers?.length === 1 && game.currentPlayers[0]._id.equals(userId),
				"Creator is the current player, like after the last join",
			);
			assert.ok(game.currentPlayers[0].deadline, "With a deadline");
			assert.strictEqual(
				await colls.gameNotifications.countDocuments({ game: "test-bots-host", kind: "gameStarted" }),
				0,
				"No gameStarted notification until the host starts the game",
			);

			// The existing /start route picks up from there (it emits gameStarted).
			const startRes = await api("POST", "/api/game/test-bots-host/start", {}, authHeaders);
			assert.strictEqual(startRes.ok, true, JSON.stringify(startRes.data));
			const started = await colls.games.findOne({ _id: "test-bots-host" });
			assert.strictEqual(started?.ready, true);
			assert.strictEqual(
				await colls.gameNotifications.countDocuments({ game: "test-bots-host", kind: "gameStarted" }),
				1,
			);
		});

		it("should not emit gameStarted for a scheduled game full at creation", async () => {
			const res = await api(
				"POST",
				"/api/game/new-game",
				newGameBody("test-bots-scheduled", { bots: 1, scheduledStart: Date.now() + 3600 * 1000 }),
				authHeaders,
			);

			assert.strictEqual(res.ok, true, JSON.stringify(res.data));
			const game = await colls.games.findOne({ _id: "test-bots-scheduled" });
			assert.ok(game, "Game should be created");
			assert.strictEqual(game.ready, true, "Ready — the cron will start it at the scheduled date");
			assert.strictEqual(
				await colls.gameNotifications.countDocuments({ game: "test-bots-scheduled", kind: "gameStarted" }),
				0,
				"No gameStarted notification before the scheduled start",
			);

			// Full-at-creation bot games stay "open" (but ready) until the game-server
			// picks them up — they still count towards the cap. Clean up behind them.
			await colls.games.deleteMany({
				_id: { $in: ["test-bots-full", "test-bots-notfull", "test-bots-host", "test-bots-invite"] },
			});
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
	});

	describe("elo range", () => {
		before(async () => {
			await colls.gamePreferences.updateOne(
				{ user: userId, game: "test" },
				{ $set: { elo: { value: 150, games: 10 } } },
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
			// The creator must be inside the range; their test3 elo pref lives on 150.
			await colls.gamePreferences.updateOne({ user: userId, game: "test3" }, { $set: { elo: { value: 150 } } });
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
			assert.strictEqual(createRes.ok, true, JSON.stringify(createRes.data));

			const res = await api("POST", "/api/game/test-elo-unrated/join", {}, joiner3AuthHeaders);
			assert.strictEqual(res.status, 422);
			assert.ok(errorMessage(res.data)?.includes("Your Elo (0)"));
		});
	});

	describe("cancel vote", () => {
		it("should cancel an active game with a bot when the human votes", async () => {
			// The bot auto-consents — no one can act for it, so its vote is implied.
			await colls.games.insertOne(
				testGame({
					_id: "cancel-bot",
					creator: userId,
					status: "active",
					players: [
						{ _id: userId, name: "human" },
						{ _id: new ObjectId(), name: "Rob (bot 1)", isBot: true },
					],
					game: { name: "test", version: 1 },
				}),
			);

			const res = await api("POST", "/api/game/cancel-bot/cancel", {}, authHeaders);

			assert.strictEqual(res.ok, true, JSON.stringify(res.data));
			const game = await colls.games.findOne({ _id: "cancel-bot" });
			assert.strictEqual(game?.status, "ended");
			assert.strictEqual(game?.cancelled, true);
			assert.deepStrictEqual(game?.currentPlayers, []);
			assert.ok(
				await colls.gameNotifications.findOne({ game: "cancel-bot", kind: "gameEnded" }),
				"gameEnded notification emitted",
			);
		});

		it("should still require every human vote in a game with humans and a bot", async () => {
			await colls.games.insertOne(
				testGame({
					_id: "cancel-humans-bot",
					creator: userId,
					status: "active",
					players: [
						{ _id: userId, name: "human1" },
						{ _id: joinerId, name: "human2" },
						{ _id: new ObjectId(), name: "Ada (bot 2)", isBot: true },
					],
					options: {
						setup: { seed: "test", nbPlayers: 3, playerOrder: "random" },
						timing: { timePerGame: 5000, timePerMove: 5000, timer: { start: 0, end: 86400 } },
					},
					game: { name: "test", version: 1 },
				}),
			);

			const firstVote = await api("POST", "/api/game/cancel-humans-bot/cancel", {}, authHeaders);
			assert.strictEqual(firstVote.ok, true, JSON.stringify(firstVote.data));

			let game = await colls.games.findOne({ _id: "cancel-humans-bot" });
			assert.strictEqual(game?.status, "active", "One human vote is not enough — the other human didn't vote");
			assert.strictEqual(game?.cancelled, false);

			const secondVote = await api("POST", "/api/game/cancel-humans-bot/cancel", {}, joinerAuthHeaders);
			assert.strictEqual(secondVote.ok, true, JSON.stringify(secondVote.data));

			game = await colls.games.findOne({ _id: "cancel-humans-bot" });
			assert.strictEqual(game?.status, "ended", "Both humans voted, bot auto-consents");
			assert.strictEqual(game?.cancelled, true);
		});

		it("should cancel when the only other player is overdue (droppable) — #403", async () => {
			const overdueId = new ObjectId();
			await colls.games.insertOne(
				testGame({
					_id: "cancel-overdue",
					creator: userId,
					status: "active",
					players: [
						{ _id: userId, name: "human1" },
						{ _id: overdueId, name: "stalled" },
					],
					currentPlayers: [
						{ _id: overdueId, timerStart: new Date(Date.now() - 3600_000), deadline: new Date(Date.now() - 60_000) },
					],
					game: { name: "test", version: 1 },
				}),
			);

			const res = await api("POST", "/api/game/cancel-overdue/cancel", {}, authHeaders);
			assert.strictEqual(res.ok, true, JSON.stringify(res.data));

			const game = await colls.games.findOne({ _id: "cancel-overdue" });
			assert.strictEqual(game?.status, "ended", "The overdue player counts as having voted cancel");
			assert.strictEqual(game?.cancelled, true);
			assert.deepStrictEqual(game?.currentPlayers, []);
			assert.ok(
				await colls.gameNotifications.findOne({ game: "cancel-overdue", kind: "gameEnded" }),
				"gameEnded notification emitted",
			);
		});

		it("should not cancel when another active player's deadline is still running — #403", async () => {
			const healthyId = new ObjectId();
			await colls.games.insertOne(
				testGame({
					_id: "cancel-healthy",
					creator: userId,
					status: "active",
					players: [
						{ _id: userId, name: "human1" },
						{ _id: healthyId, name: "active-player" },
					],
					currentPlayers: [{ _id: healthyId, timerStart: new Date(), deadline: new Date(Date.now() + 3600_000) }],
					game: { name: "test", version: 1 },
				}),
			);

			const res = await api("POST", "/api/game/cancel-healthy/cancel", {}, authHeaders);
			assert.strictEqual(res.ok, true, JSON.stringify(res.data));

			const game = await colls.games.findOne({ _id: "cancel-healthy" });
			assert.strictEqual(game?.status, "active", "A non-overdue active player still blocks the cancel");
			assert.strictEqual(game?.cancelled, false);
			assert.strictEqual(game?.players[0].voteCancel, true, "The vote is still recorded");
		});

		it("should cancel when the caller votes and the only other vote is a now-overdue player's — #403", async () => {
			// A player who voted cancel and then went overdue counts as an implied vote,
			// not as the required real one — but the caller's own fresh vote fills that
			// role, so the game is cancelled.
			const overdueVoterId = new ObjectId();
			await colls.games.insertOne(
				testGame({
					_id: "cancel-overdue-voter",
					creator: userId,
					status: "active",
					players: [
						{ _id: userId, name: "human1" },
						{ _id: overdueVoterId, name: "stalled", voteCancel: true },
					],
					currentPlayers: [
						{
							_id: overdueVoterId,
							timerStart: new Date(Date.now() - 3600_000),
							deadline: new Date(Date.now() - 60_000),
						},
					],
					game: { name: "test", version: 1 },
				}),
			);

			const res = await api("POST", "/api/game/cancel-overdue-voter/cancel", {}, authHeaders);
			assert.strictEqual(res.ok, true, JSON.stringify(res.data));

			const game = await colls.games.findOne({ _id: "cancel-overdue-voter" });
			assert.strictEqual(game?.status, "ended", "The caller's own vote is the required real vote");
			assert.strictEqual(game?.cancelled, true);
		});
	});

	describe("game lock serialization (#280)", () => {
		// cancel/quit/drop used to lock `game-cancel:<id>` while game-server moves
		// lock `game:<id>` — different keys, so a cancel could interleave with an
		// in-flight move. They now block on the shared `game:<id>` key.
		async function assertWaitsForGameLock(gameId: string, request: () => Promise<{ status: number; data: unknown }>) {
			const gameLock = await locks.lock("game", gameId);
			assert.ok(gameLock, "the test acquired the game lock");
			try {
				let settled = false;
				const pending = request().finally(() => {
					settled = true;
				});

				await new Promise((r) => setTimeout(r, 400));
				assert.strictEqual(settled, false, "the route waits while game:<id> is held");

				await gameLock.free();
				const res = await pending;
				assert.strictEqual(res.status, 200, JSON.stringify(res.data));
			} finally {
				await gameLock.free();
			}
		}

		it("cancel waits for the game:<id> lock", async () => {
			await colls.games.insertOne(
				testGame({
					_id: "lock-cancel",
					creator: userId,
					status: "active",
					players: [
						{ _id: userId, name: "human" },
						{ _id: new ObjectId(), name: "Rob (bot 1)", isBot: true },
					],
					game: { name: "test", version: 1 },
				}),
			);

			await assertWaitsForGameLock("lock-cancel", () => api("POST", "/api/game/lock-cancel/cancel", {}, authHeaders));

			const game = await colls.games.findOne({ _id: "lock-cancel" });
			assert.strictEqual(game?.cancelled, true, "The cancel was applied once the lock was released");
		});

		it("quit waits for the game:<id> lock", async () => {
			await colls.games.insertOne(
				testGame({
					_id: "lock-quit",
					creator: userId,
					status: "active",
					players: [
						{ _id: userId, name: "human1" },
						{ _id: joinerId, name: "human2" },
					],
					game: { name: "test", version: 1 },
				}),
			);

			await assertWaitsForGameLock("lock-quit", () => api("POST", "/api/game/lock-quit/quit", {}, joinerAuthHeaders));

			assert.ok(
				await colls.gameNotifications.findOne({ game: "lock-quit", kind: "playerQuit", user: joinerId }),
				"The quit notification was emitted once the lock was released",
			);
		});

		it("drop waits for the game:<id> lock", async () => {
			await colls.games.insertOne(
				testGame({
					_id: "lock-drop",
					creator: userId,
					status: "active",
					players: [
						{ _id: userId, name: "human1" },
						{ _id: joinerId, name: "overdue" },
					],
					currentPlayers: [
						{ _id: joinerId, timerStart: new Date(Date.now() - 3600_000), deadline: new Date(Date.now() - 60_000) },
					],
					game: { name: "test", version: 1 },
				}),
			);

			await assertWaitsForGameLock("lock-drop", () =>
				api("POST", `/api/game/lock-drop/drop/${joinerId.toHexString()}`, {}, authHeaders),
			);

			assert.ok(
				await colls.gameNotifications.findOne({ game: "lock-drop", kind: "dropPlayer", user: joinerId }),
				"The drop notification was emitted once the lock was released",
			);
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

	it("should expose lastMoveInfo in the active game list (#208)", async () => {
		const moverId = new ObjectId();
		const at = new Date();
		await colls.games.insertOne(
			testGame({
				_id: "list-lastmove",
				creator: userId,
				status: "active",
				players: [
					{ _id: moverId, name: "mover" },
					{ _id: joinerId, name: "other" },
				],
				game: { name: "test", version: 1 },
				lastMoveInfo: { player: moverId, move: "terrans build m 1x0", at, moveNumber: 12 },
			}),
		);
		await colls.games.insertOne(
			testGame({
				_id: "list-no-move",
				creator: userId,
				status: "active",
				players: [{ _id: moverId, name: "mover" }],
				game: { name: "test", version: 1 },
				lastMoveInfo: null,
			}),
		);

		const res = await api("GET", "/api/game/status/active?boardgame=test", undefined, authHeaders);

		assert.strictEqual(res.ok, true, JSON.stringify(res.data));
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- response body is untyped JSON
		const games = res.data as {
			_id: string;
			lastMoveInfo?: { player: unknown; move: string; at: string; moveNumber: number } | null;
		}[];
		const withMove = games.find((g) => g._id === "list-lastmove");
		assert.ok(withMove, "The game is in the list");
		assert.strictEqual(withMove.lastMoveInfo?.move, "terrans build m 1x0");
		assert.strictEqual(withMove.lastMoveInfo?.moveNumber, 12);
		assert.strictEqual(withMove.lastMoveInfo?.player, moverId.toHexString());
		const withoutMove = games.find((g) => g._id === "list-no-move");
		assert.ok(withoutMove, "The no-move game is in the list");
		assert.strictEqual(withoutMove.lastMoveInfo, null, "No move yet → explicitly null");
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
