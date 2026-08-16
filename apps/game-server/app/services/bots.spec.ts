// Run via `pnpm test` (the package.json script), NOT bare `node --test`: the spec
// needs a Mongo db (dbUrl/dbName env, see AGENTS.md) and spawns engine workers.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import { colls, closeDb } from "../config/db.ts";
import { engineRunner } from "./engine-runner.ts";
import { engineKey } from "./engines.ts";
import { processQuit, startNextGame } from "./game.ts";

// The driver polls with BOT_MOVE_DELAY_MS between moves — keep the suite fast.
process.env.BOT_MOVE_DELAY_MS ??= "50";

const ENGINE_NAME = "bot-test";
const ENGINE_VERSION = 1;

// A minimal engine whose bots auto-play "charge" moves; the game ends once every
// player banked `movesToEnd` moves. currentPlayer is strictly sequential.
function makeEngine(dir: string) {
	fs.writeFileSync(
		path.join(dir, "engine.mjs"),
		`export async function init(players) {
			return { n: players, moves: Array(players).fill(0), current: 0, log: [] };
		}
		export async function move(data, move, player) {
			if (player !== data.current) throw new Error("not your turn");
			data.moves[player]++;
			data.log.push("player " + player + " banks a charge");
			data.current = (data.current + 1) % data.n;
			return data;
		}
		export async function moveAI(data, player) {
			return move(data, "ai", player);
		}
		export function ended(data) {
			return data.moves.every((m) => m >= 3);
		}
		export function scores(data) {
			return data.moves;
		}
		export function currentPlayer(data) {
			return ended(data) ? undefined : data.current;
		}
		export function logLength(data) {
			return data.log.length;
		}
		export function logSlice(data, options) {
			return { log: data.log.slice(options?.start, options?.end), availableMoves: ["ai"] };
		}
		export async function dropPlayer(data, player) {
			data.moves[player] = 3;
			if (data.current === player) data.current = (data.current + 1) % data.n;
			return data;
		}`,
	);
	return path.join(dir, "engine.mjs");
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
	const start = Date.now();
	for (;;) {
		if (await cond()) {
			return;
		}
		if (Date.now() - start > timeoutMs) {
			throw new Error("Timed out waiting for condition");
		}
		await new Promise((r) => setTimeout(r, 25));
	}
}

function botPlayer(name: string) {
	return {
		_id: new ObjectId(),
		remainingTime: 5000,
		score: 0,
		dropped: false,
		quit: false,
		name,
		isBot: true,
	};
}

function humanPlayer(name: string) {
	return {
		_id: new ObjectId(),
		remainingTime: 5000,
		score: 0,
		dropped: false,
		quit: false,
		name,
	};
}

// engines.ts resolves engines from ../../games/node_modules/<engineKey>/<entryPoint>
// — copy the fixture engine there directly (no npm install in tests).
function installEngine(game: string, version: number, pkgName: string, pkgVersion: string, sourceFile: string) {
	const key = engineKey(game, version, { name: pkgName, version: pkgVersion });
	const dir = new URL(`../../games/node_modules/${key}/`, import.meta.url);
	fs.mkdirSync(dir, { recursive: true });
	fs.copyFileSync(sourceFile, new URL(path.basename(sourceFile), dir));
}

describe("bot driver", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-bot-engine-"));
	const entryPoint = makeEngine(dir);
	const creatorId = new ObjectId();

	async function insertGame(
		gameId: string,
		players: (ReturnType<typeof botPlayer> | ReturnType<typeof humanPlayer>)[],
	) {
		await colls.games.insertOne({
			_id: gameId,
			players,
			creator: creatorId,
			currentPlayers: [],
			data: {},
			context: { round: 0 },
			options: {
				setup: { seed: gameId, nbPlayers: players.length, playerOrder: "join" },
				timing: { timePerGame: 5000, timePerMove: 5000, timer: { start: 0, end: 86400 } },
			},
			game: { name: ENGINE_NAME, version: ENGINE_VERSION, expansions: [] },
			status: "open",
			ready: true,
			cancelled: false,
			createdAt: new Date(),
			updatedAt: new Date(),
			lastMove: new Date(),
		});
		await colls.gameNotifications.insertOne({
			game: gameId,
			kind: "gameStarted",
			processed: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}

	before(async () => {
		// Only clear this suite's own fixtures — the full suite runs several spec files
		// concurrently against the same test db, and a dropDatabase() here would wipe
		// another file's state mid-run.
		await colls.games.deleteMany({
			_id: { $in: ["bot-game-1", "bot-game-2", "bot-game-noai", "bot-game-cancel", "bot-game-log"] },
		});
		await colls.gameNotifications.deleteMany({
			game: { $in: ["bot-game-1", "bot-game-2", "bot-game-noai", "bot-game-cancel", "bot-game-log"] },
		});
		await colls.gameInfos.deleteMany({ "_id.game": { $in: [ENGINE_NAME, "bot-test-noai", "bot-test-log"] } });
		// Register the engine: getEngine/enginePath resolve via gameInfos.
		await colls.gameInfos.insertOne({
			_id: { game: ENGINE_NAME, version: ENGINE_VERSION },
			viewer: { url: "//test/bot" },
			public: true,
			meta: { bots: true },
			engine: { package: { name: "@test/bot", version: "1.0.0" }, entryPoint: path.basename(entryPoint) },
		});
		// engines.ts resolves ../../games/node_modules/<engineKey>/<entryPoint> — place
		// the engine there directly (no npm install in tests).
		installEngine(ENGINE_NAME, ENGINE_VERSION, "@test/bot", "1.0.0", entryPoint);
	});

	after(async () => {
		await engineRunner.close();
		await closeDb();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	// startNextGame polls one unprocessed gameStarted notification; loop until this
	// game's is processed (deterministic regardless of other pending notifications).
	async function startGame(gameId: string) {
		await waitFor(async () => {
			await startNextGame();
			const n = await colls.gameNotifications.findOne({ game: gameId, kind: "gameStarted" });
			return !!n?.processed;
		});
	}

	it("a bot auto-plays when it becomes current, until the game ends", async () => {
		// 2 players: bot first, human second. The human never moves in this test —
		// so this covers start → bot auto-plays, then the turn passes to the human.
		await insertGame("bot-game-1", [botPlayer("Rob (bot 1)"), humanPlayer("human")]);

		await startGame("bot-game-1");
		const started = await colls.games.findOne({ _id: "bot-game-1" });
		assert.strictEqual(started?.status, "active");
		assert.strictEqual(started?.lastMoveInfo, null, "No move yet at game start (#208)");
		assert.strictEqual(started?.currentPlayers?.length, 1);
		assert.ok(
			started?.players[0].isBot && started.currentPlayers[0]._id.equals(started.players[0]._id),
			"Bot is the first current player",
		);

		// The driver (scheduled by startNextGame) keeps moving the bot until it's the
		// human's turn; the human then stays current (no further progress).
		await waitFor(async () => {
			const game = await colls.games.findOne({ _id: "bot-game-1" });
			return !!game && !game.players.some((pl) => pl.isBot && game.currentPlayers?.some((cp) => cp._id.equals(pl._id)));
		});

		const game = await colls.games.findOne({ _id: "bot-game-1" });
		assert.ok(game);
		assert.strictEqual(game.status, "active");
		assert.ok(game.currentPlayers?.[0]._id.equals(game.players[1]._id), "Turn passed to the human");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine data shape is defined by the fixture engine
		const data = game.data as { moves: number[] } | undefined;
		assert.ok(data && data.moves[0] >= 1, "The bot played at least one move");

		// No turn notification for the bot; exactly one for the human.
		const botNotifs = await colls.gameNotifications.countDocuments({
			game: "bot-game-1",
			kind: "currentMove",
			user: game.players[0]._id,
		});
		const humanNotifs = await colls.gameNotifications.countDocuments({
			game: "bot-game-1",
			kind: "currentMove",
			user: game.players[1]._id,
		});
		assert.strictEqual(botNotifs, 0, "Bots never get currentMove notifications");
		assert.ok(humanNotifs >= 1, "The human got their turn notification");

		// Bot moves count for the standardized last-move field (#208), and the text is
		// the engine's log line for that move (not raw notation) — read from logSlice.
		assert.ok(game.lastMoveInfo, "The bot move was recorded");
		assert.ok(game.lastMoveInfo.player.equals(game.players[0]._id), "Last mover is the bot");
		assert.strictEqual(game.lastMoveInfo.move, "player 0 banks a charge", "Last-move text is the engine log line");
		assert.strictEqual(game.lastMoveInfo.moveNumber, data?.moves[0]);
		assert.ok(game.lastMoveInfo.at.getTime() > 0);
	});

	it("bots chain moves between themselves and the game ends with scores", async () => {
		// Two bots alternate until the engine reports the game ended.
		await insertGame("bot-game-2", [botPlayer("Rob (bot 1)"), botPlayer("Ada (bot 2)")]);

		await startGame("bot-game-2");

		// Wait on the gameEnded notification, not status: afterMove writes the game
		// doc (status "ended") before inserting the notification, so polling status
		// races ahead of the notification write.
		await waitFor(async () => {
			const n = await colls.gameNotifications.countDocuments({ game: "bot-game-2", kind: "gameEnded" });
			return n > 0;
		});

		const game = await colls.games.findOne({ _id: "bot-game-2" });
		assert.ok(game);
		assert.strictEqual(game.status, "ended");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine data shape is defined by the fixture engine
		const data = game.data as { moves: number[] } | undefined;
		assert.deepStrictEqual(data?.moves, [3, 3], "Both bots played to the end");
		assert.deepStrictEqual(
			game.players.map((pl) => pl.score),
			[3, 3],
			"Scores were recorded",
		);
		assert.ok(
			game.players.every((pl) => pl.ranking === 1),
			"Rankings recorded",
		);
		assert.ok(game.lastMoveInfo, "The last bot move was recorded (#208)");
		assert.ok(game.lastMoveInfo.player.equals(game.players[1]._id), "Player 2 played last (strict alternation)");
		assert.strictEqual(game.lastMoveInfo.move, "player 1 banks a charge", "Last-move text is the newest log line");
		assert.strictEqual(game.lastMoveInfo.moveNumber, 6);

		const endedNotifs = await colls.gameNotifications.countDocuments({ game: "bot-game-2", kind: "gameEnded" });
		assert.strictEqual(endedNotifs, 1, "gameEnded notification emitted exactly once");
		const moveNotifs = await colls.gameNotifications.countDocuments({ game: "bot-game-2", kind: "currentMove" });
		assert.strictEqual(moveNotifs, 0, "No currentMove notifications at all in an all-bot game");
	});

	it("a drop during a bot's turn cancels the game when every human agreed to cancel", async () => {
		// The human voted to cancel (voteCancel), the bot auto-consents (isBot): the
		// afterMove cancel check must not let the bot block the cancellation. This
		// also exercises the bot's-turn case: dropping the current player advances
		// the turn, and afterMove observes the cancelled game before the bot driver
		// can move again (the driver no-ops on non-active games).
		const human = { ...humanPlayer("human"), voteCancel: true };
		await insertGame("bot-game-cancel", [botPlayer("Rob (bot 1)"), human]);

		await startGame("bot-game-cancel");
		const started = await colls.games.findOne({ _id: "bot-game-cancel" });
		assert.strictEqual(started?.status, "active");

		// The human times out and is dropped while the bot is current.
		await processQuit({ kind: "dropPlayer", game: "bot-game-cancel", user: human._id, processed: false });

		await waitFor(async () => {
			const game = await colls.games.findOne({ _id: "bot-game-cancel" });
			return game?.status === "ended";
		});

		const game = await colls.games.findOne({ _id: "bot-game-cancel" });
		assert.ok(game);
		assert.strictEqual(game.cancelled, true, "Bot auto-consents to the human's cancel vote");
		assert.strictEqual(game.players[1].dropped, true);
	});

	it("derives the last-move text from powergrid-style object log entries, and falls back to raw notation on an empty slice", async () => {
		// Engine whose log entries are objects ({simple} like powergrid) and whose
		// bot produces no log entry on its second move (→ raw-notation fallback).
		const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-bot-engine-log-"));
		fs.writeFileSync(
			path.join(dir2, "engine.mjs"),
			`export async function init(players) {
				return { n: players, moves: Array(players).fill(0), current: 0, log: [] };
			}
			export async function move(data, move, player) {
				if (player !== data.current) throw new Error("not your turn");
				data.moves[player]++;
				// First move appends an object entry with a plain-text \`simple\` field
				// (powergrid shape), then an \`event\` entry — the event is phase noise
				// and must be skipped in favour of the move line. Later moves append
				// nothing → fallback to raw notation.
				if (data.moves[player] === 1) {
					data.log.push({ type: "move", player, simple: "Rob banks a charge for 2 power." });
					data.log.push({ type: "event", event: "A new card is drawn." });
				}
				data.current = (data.current + 1) % data.n;
				return data;
			}
			export async function moveAI(data, player) { return move(data, "ai", player); }
			export function ended(data) { return data.moves.every((m) => m >= 2); }
			export function scores(data) { return data.moves; }
			export function currentPlayer(data) { return ended(data) ? undefined : data.current; }
			export function logLength(data) { return data.log.length; }
			export function logSlice(data, options) {
				return { log: data.log.slice(options?.start, options?.end), availableMoves: [] };
			}
			export async function dropPlayer(data, player) { data.moves[player] = 2; return data; }`,
		);
		const game = "bot-game-log";
		await colls.gameInfos.insertOne({
			_id: { game: "bot-test-log", version: 1 },
			viewer: { url: "//test/bot" },
			public: true,
			meta: { bots: true },
			engine: { package: { name: "@test/bot-log", version: "1.0.0" }, entryPoint: "engine.mjs" },
		});
		installEngine("bot-test-log", 1, "@test/bot-log", "1.0.0", path.join(dir2, "engine.mjs"));

		await insertGame(game, [botPlayer("Rob (bot 1)"), humanPlayer("human")]);
		// Re-point the game at the log engine
		await colls.games.updateOne({ _id: game }, { $set: { "game.name": "bot-test-log", "game.version": 1 } });
		await startGame(game);

		// Bot plays move 1 → object entry with \`simple\` text is surfaced.
		await waitFor(async () => {
			const g = await colls.games.findOne({ _id: game });
			return !!g && !g.players.some((pl) => pl.isBot && g.currentPlayers?.some((cp) => cp._id.equals(pl._id)));
		});
		const g = await colls.games.findOne({ _id: game });
		assert.strictEqual(
			g?.lastMoveInfo?.move,
			"Rob banks a charge for 2 power.",
			"Object entry → simple text, event skipped",
		);
		assert.strictEqual(g?.lastMoveInfo?.moveNumber, 2, "move + event entries both counted");

		fs.rmSync(dir2, { recursive: true, force: true });
	});

	it("a broken moveAI leaves the game active (bot stuck), without looping", async () => {
		// Engine without moveAI at all: the worker reports "no method moveAI".
		const noAiDir = fs.mkdtempSync(path.join(os.tmpdir(), "bgs-bot-engine-noai-"));
		fs.writeFileSync(
			path.join(noAiDir, "engine.mjs"),
			`export async function init(players) { return { n: players, current: 0 }; }
			 export function ended() { return false; }
			 export function scores(data) { return Array(data.n).fill(0); }
			 export function currentPlayer(data) { return data.current; }
			 export function logLength() { return 0; }
			 export function logSlice() { return {}; }
			 export async function dropPlayer(data) { return data; }`,
		);
		const noAiGame = "bot-game-noai";
		await colls.gameInfos.insertOne({
			_id: { game: "bot-test-noai", version: 1 },
			viewer: { url: "//test/bot" },
			public: true,
			meta: { bots: true },
			engine: { package: { name: "@test/bot-noai", version: "1.0.0" }, entryPoint: "engine.mjs" },
		});
		installEngine("bot-test-noai", 1, "@test/bot-noai", "1.0.0", path.join(noAiDir, "engine.mjs"));

		await colls.games.insertOne({
			_id: noAiGame,
			players: [botPlayer("Rob (bot 1)"), humanPlayer("human")],
			creator: creatorId,
			currentPlayers: [],
			data: {},
			context: { round: 0 },
			options: {
				setup: { seed: noAiGame, nbPlayers: 2, playerOrder: "join" },
				timing: { timePerGame: 5000, timePerMove: 5000, timer: { start: 0, end: 86400 } },
			},
			game: { name: "bot-test-noai", version: 1, expansions: [] },
			status: "open",
			ready: true,
			cancelled: false,
			createdAt: new Date(),
			updatedAt: new Date(),
			lastMove: new Date(),
		});
		await colls.gameNotifications.insertOne({
			game: noAiGame,
			kind: "gameStarted",
			processed: false,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		await startGame(noAiGame);

		// Give the driver ample time to attempt (and fail) the bot move.
		await new Promise((r) => setTimeout(r, 1500));

		const game = await colls.games.findOne({ _id: noAiGame });
		assert.ok(game);
		assert.strictEqual(game.status, "active", "Game is not wedged — bot is simply stuck");
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine data shape is defined by the fixture engine
		const data = game.data as { current: number } | undefined;
		assert.strictEqual(data?.current, 0, "No move was applied");
		fs.rmSync(noAiDir, { recursive: true, force: true });
	});
});
