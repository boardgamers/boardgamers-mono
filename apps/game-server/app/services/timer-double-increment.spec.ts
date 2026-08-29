// Reproduction for Codeberg issue #311: "Short games: per-move increment
// applied twice for alternating movers".
//
// In a short game (timePerMove <= 15min), the gameplay route adds +timePerMove
// to the mover's remainingTime before calling afterMove ("add time back every
// move" workaround for #12), and afterMove's leaving-current-player block used
// to add +timePerMove a second time. The double-count was masked by the
// min(timePerGame, …) Fischer cap on both layers — it only shows when the cap
// isn't hit (a player down on time making a quick move).
//
// These tests replicate the exact production sequence (route pre-credit, then
// afterMove) and assert the increment lands exactly once for alternating
// movers, still lands for bot moves (no route pre-credit there), and that the
// Fischer cap still holds.
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

// The gameplay route's pre-credit for short games (gameplay.ts "for fast games,
// add time back every move") — replicated so the test runs the same sequence
// production does. Callers then pass incrementCredited: true to afterMove, like
// the route.
function routeAddIncrement(game: GameDoc, playerIndex: number) {
	const player = game.players[playerIndex];
	player.remainingTime = Math.min(timePerGame, (player.remainingTime ?? timePerGame) + timePerMove);
}

async function remainingTime(gameId: string, playerIndex: number): Promise<number> {
	const stored = await colls.games.findOne({ _id: gameId }, { projection: { players: 1 } });
	return stored?.players[playerIndex].remainingTime ?? 0;
}

describe("afterMove timing — double per-move increment (Codeberg #311)", () => {
	after(async () => {
		await closeDb();
	});

	it("applies the increment exactly once for an alternating mover in a short game", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-alternating";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		const game = await colls.games.findOne({ _id: gameId });
		assert.ok(game);

		// Player 0 moves (~0s of think time); player 1 becomes current. Route
		// pre-credit: 100 -> 130. afterMove must NOT add a second +30.
		const data = await engine.move(game.data, "move", 0);
		routeAddIncrement(game, 0);
		await afterMove(engine, game, data, false, {
			player: 0,
			move: "move",
			logLengthBefore: 0,
			incrementCredited: true,
		});

		const rt = await remainingTime(gameId, 0);
		assert.ok(
			Math.abs(rt - (100 + timePerMove)) <= 2,
			`expected remainingTime ≈ ${100 + timePerMove} (single increment), got ${rt} — double increment would give ${100 + 2 * timePerMove}`,
		);
	});

	it("still credits the increment on bot moves, which get no route pre-credit", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-bot-move";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		const game = await colls.games.findOne({ _id: gameId });
		assert.ok(game);

		// The bot driver (bots.ts) calls afterMove with lastMove but no route
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

		// Player 0 nearly at the cap: route pre-credit clamps to timePerGame, and
		// afterMove must leave it there.
		await colls.games.updateOne({ _id: gameId }, { $set: { "players.0.remainingTime": 290 } });
		const game = await colls.games.findOne({ _id: gameId });
		assert.ok(game);

		const data = await engine.move(game.data, "move", 0);
		routeAddIncrement(game, 0);
		await afterMove(engine, game, data, false, {
			player: 0,
			move: "move",
			logLengthBefore: 0,
			incrementCredited: true,
		});

		const rt = await remainingTime(gameId, 0);
		assert.ok(rt <= timePerGame, `remainingTime must stay capped at ${timePerGame}, got ${rt}`);
		assert.ok(rt > 290 - 2, `remainingTime should not drop below the pre-move value, got ${rt}`);
	});
});
