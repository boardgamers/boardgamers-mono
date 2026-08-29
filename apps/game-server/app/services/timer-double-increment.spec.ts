// Regression for Codeberg issue #311: "Short games: per-move increment applied
// twice for alternating movers".
//
// The double-count came from the increment living in two layers: the /move
// route pre-credited +timePerMove for short games ("add time back every move",
// the #12 workaround) and afterMove's leaving-current-player block credited
// again. The increment now lives in afterMove alone: a real saved move
// (lastMove set — route and bot moves) credits exactly the mover exactly once,
// capped at timePerGame; callers without lastMove (replays, admin data edits,
// drop/quit) get no increment at all.
//
// Run via `pnpm test` (needs a Mongo db, see AGENTS.md), NOT bare `node --test`.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import type { GameDoc } from "@bgs/models";
import { colls, closeDb } from "../config/db.ts";
import { afterMove } from "./game.ts";
import type { Engine, GameData } from "../types/engine.ts";

// Short game: 5min per game + 30s per move.
const timePerGame = 300;
const timePerMove = 30;

interface TimerData {
	moves: number;
}

// Mock engine with strict alternation: player (moves % 2) is current.
function makeEngine(): Engine {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine data shape is defined by this fixture engine
	const moves = (data: GameData) => (data as TimerData).moves;
	return {
		init: async () => ({ moves: 0 }),
		move: async (data) => ({ moves: moves(data) + 1 }),
		ended: (data) => moves(data) >= 99,
		scores: () => [0, 0],
		dropPlayer: async (data) => data,
		currentPlayer: (data) => (moves(data) >= 99 ? undefined : moves(data) % 2),
		logLength: (data) => moves(data),
		logSlice: () => ({ log: [], availableMoves: [] }),
		setPlayerMetaData: (data) => data,
		setPlayerSettings: (data) => data,
		playerSettings: () => ({}),
		rankings: () => [1, 2],
		round: () => 0,
		cancelled: () => false,
		factions: () => ["p0", "p1"],
		messages: (data) => ({ messages: [], data }),
		replay: (data) => data,
		stats: () => ({}),
	};
}

function makeGame(gameId: string): GameDoc {
	const p0 = new ObjectId();
	const p1 = new ObjectId();
	const game = {
		_id: gameId,
		players: [
			// Player 0 is down on time (100s): far enough under the Fischer cap that
			// a double increment (100 + 30 + 30 = 160) stays below timePerGame (300)
			// and is observable.
			{ _id: p0, remainingTime: 100, score: 0, dropped: false, quit: false, name: "p0" },
			{ _id: p1, remainingTime: timePerGame, score: 0, dropped: false, quit: false, name: "p1" },
		],
		creator: p0,
		// Player 0 is current, with their clock just (re)started.
		currentPlayers: [{ _id: p0, timerStart: new Date(), deadline: new Date(Date.now() + 100000) }],
		data: { moves: 0 },
		context: { round: 0 },
		options: {
			setup: { seed: gameId, nbPlayers: 2, playerOrder: "join" },
			timing: { timePerGame, timePerMove, timer: { start: 0, end: 86400 } },
		},
		game: { name: "timer-test", version: 1, expansions: [] },
		status: "active",
		ready: true,
		cancelled: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		lastMove: new Date(),
	};
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fixture doc; the Zod schema is looser than the runtime shape
	return game as GameDoc;
}

async function remainingTime(gameId: string, playerIndex: number): Promise<number> {
	const stored = await colls.games.findOne({ _id: gameId }, { projection: { players: 1 } });
	return stored?.players[playerIndex].remainingTime ?? 0;
}

async function freshGame(gameId: string): Promise<GameDoc> {
	const game = await colls.games.findOne({ _id: gameId });
	assert.ok(game);
	return game;
}

describe("afterMove timing — per-move increment exactly once (Codeberg #311)", () => {
	after(async () => {
		await closeDb();
	});

	it("applies the increment exactly once for an alternating mover in a short game", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-alternating";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		const game = await freshGame(gameId);

		// Player 0 moves (~0s of think time); player 1 becomes current. afterMove
		// alone must credit exactly one +30.
		const data = await engine.move(game.data, "move", 0);
		await afterMove(engine, game, data, false, { player: 0, move: "move", logLengthBefore: 0 });

		const rt = await remainingTime(gameId, 0);
		assert.ok(
			Math.abs(rt - (100 + timePerMove)) <= 2,
			`expected remainingTime ≈ ${100 + timePerMove} (single increment), got ${rt} — double increment would give ${100 + 2 * timePerMove}`,
		);
	});

	it("credits a bot move exactly once", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-bot-move";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		const game = await freshGame(gameId);

		// The bot driver (bots.ts) calls afterMove with lastMove and no route
		// pre-credit — afterMove must add the increment itself.
		const data = await engine.move(game.data, "move", 0);
		await afterMove(engine, game, data, false, { player: 0, move: null, logLengthBefore: 0 });

		const rt = await remainingTime(gameId, 0);
		assert.ok(
			Math.abs(rt - (100 + timePerMove)) <= 2,
			`expected remainingTime ≈ ${100 + timePerMove} (increment from afterMove), got ${rt}`,
		);
	});

	it("keeps the Fischer cap: no credit beyond timePerGame", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-capped";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		// Player 0 nearly at the cap: the credit must clamp to timePerGame.
		await colls.games.updateOne({ _id: gameId }, { $set: { "players.0.remainingTime": 290 } });
		const game = await freshGame(gameId);

		const data = await engine.move(game.data, "move", 0);
		await afterMove(engine, game, data, false, { player: 0, move: "move", logLengthBefore: 0 });

		const rt = await remainingTime(gameId, 0);
		assert.ok(rt <= timePerGame, `remainingTime must stay capped at ${timePerGame}, got ${rt}`);
		assert.ok(rt > 290 - 2, `remainingTime should not drop below the pre-move value, got ${rt}`);
	});

	it("credits no increment without lastMove (replay / admin data edit / drop-quit)", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-replay";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		const game = await freshGame(gameId);

		// Replays, admin data edits and drop/quit call afterMove with no lastMove:
		// nobody gets credited — not even the player leaving the current set.
		const data = await engine.move(game.data, "move", 0);
		await afterMove(engine, game, data, false);

		const rt0 = await remainingTime(gameId, 0);
		assert.ok(Math.abs(rt0 - 100) <= 2, `expected player 0 remainingTime ≈ 100 (no increment on replay), got ${rt0}`);
		const rt1 = await remainingTime(gameId, 1);
		assert.ok(
			Math.abs(rt1 - timePerGame) <= 2,
			`expected player 1 remainingTime ≈ ${timePerGame} (untouched), got ${rt1}`,
		);
	});

	it("still floors a flagged mover's credit at timePerMove", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-flagged";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		// Player 0 has 5s left but their clock has been running for 60s: the
		// elapsed charge drives remainingTime negative. The increment's floor
		// (max(·, timePerMove)) still gives them a full increment to move with —
		// flagging is enforced by the deadline watchdog, not by this charge.
		await colls.games.updateOne(
			{ _id: gameId },
			{
				$set: {
					"players.0.remainingTime": 5,
					"currentPlayers.0.timerStart": new Date(Date.now() - 60000),
				},
			},
		);
		const game = await freshGame(gameId);

		const data = await engine.move(game.data, "move", 0);
		await afterMove(engine, game, data, false, { player: 0, move: "move", logLengthBefore: 0 });

		const rt = await remainingTime(gameId, 0);
		assert.ok(
			Math.abs(rt - timePerMove) <= 2,
			`expected remainingTime ≈ ${timePerMove} (floor at the increment), got ${rt}`,
		);
	});
});
