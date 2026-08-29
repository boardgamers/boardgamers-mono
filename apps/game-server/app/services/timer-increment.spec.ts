// Reproduction for issue #12: "Time not added every move for short games".
//
// Scenario from the issue: a quick game (5min + 30s/move). Near the end, every
// opponent has passed and one player is left alone — they must play several
// turns in a row while REMAINING the current player. The Fischer increment
// (timePerMove) should accrue on each of those moves, and the turn deadline
// must move out accordingly.
//
// Run via `pnpm test` (needs a Mongo db, see AGENTS.md), NOT bare `node --test`.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import type { GameDoc } from "@bgs/models";
import { colls, closeDb } from "../config/db.ts";
import { afterMove } from "./game.ts";
import type { Engine, GameData } from "../types/engine.ts";

// Short game: 5min per game + 30s per move (the issue's "5min + 30sec").
const timePerGame = 300;
const timePerMove = 30;

interface TimerData {
	moves: number;
}

// Mock engine where player 0 STAYS current across consecutive moves (player 1
// has "passed"): the "last player left alone" case from the issue. The engine
// state is just a counter of how many moves player 0 banked.
function makeEngine(): Engine {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine data shape is defined by this fixture engine
	const moves = (data: GameData) => (data as TimerData).moves;
	return {
		init: async () => ({ moves: 0 }),
		move: async (data) => ({ moves: moves(data) + 1 }),
		ended: (data) => moves(data) >= 99,
		scores: () => [0, 0],
		dropPlayer: async (data) => data,
		// Player 0 is always current until the game ends.
		currentPlayer: (data) => (moves(data) >= 99 ? undefined : 0),
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
			{ _id: p0, remainingTime: 150, score: 0, dropped: false, quit: false, name: "p0" },
			{ _id: p1, remainingTime: timePerGame, score: 0, dropped: false, quit: false, name: "p1" },
		],
		creator: p0,
		// Player 0 is current, and their clock has been running for ~2s. The deadline
		// is consistent with remainingTime (150s): now + ~148s.
		currentPlayers: [{ _id: p0, timerStart: new Date(Date.now() - 2000), deadline: new Date(Date.now() + 148000) }],
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

// afterMove owns the per-move increment end to end (the route pre-credit
// workaround is gone): a real saved move (lastMove set) credits the mover
// exactly once, whether they stay current or leave. The tests below call
// afterMove exactly like the /move route does.
describe("afterMove timing — per-move increment (issue #12)", () => {
	after(async () => {
		await closeDb();
	});

	it("adds the per-move increment on every move, including when the mover stays current", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-stays-current";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		// Player 0 makes 3 consecutive moves while STAYING current; ~2s elapses per
		// move. The increment (30s) must outweigh the time spent thinking.
		let data: GameData = { moves: 0 };
		for (let i = 0; i < 3; i++) {
			const stored = await colls.games.findOne({ _id: gameId });
			assert.ok(stored);
			const before = stored.players[0].remainingTime ?? 0;

			// Back-date the running clock by ~2s to simulate thinking time.
			await colls.games.updateOne(
				{ _id: gameId },
				{ $set: { "currentPlayers.0.timerStart": new Date(Date.now() - 2000) } },
			);
			const fresh = await colls.games.findOne({ _id: gameId });
			assert.ok(fresh);

			data = await engine.move(data, "move", 0);
			await afterMove(engine, fresh, data, false, {
				player: 0,
				move: "move",
				logLengthBefore: engine.logLength(data) - 1,
			});

			const afterMove_ = (await colls.games.findOne({ _id: gameId }))?.players[0].remainingTime ?? 0;
			assert.ok(
				afterMove_ > before,
				`move ${i + 1}: expected remainingTime to increase (increment added), got ${before} -> ${afterMove_}`,
			);
		}
	});

	it("extends the turn deadline when the mover stays current (the actual #12 symptom)", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-deadline";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		// Player 0 stays current and makes a move. Their remainingTime goes up by
		// the increment, so their turn DEADLINE — what the frontend counts down to
		// and what the inactivity auto-cancel reads — must move out.
		const before = await colls.games.findOne({ _id: gameId });
		assert.ok(before);
		const deadlineBefore = before.currentPlayers?.[0].deadline?.getTime() ?? 0;

		const data = await engine.move(before.data, "move", 0);
		await afterMove(engine, before, data, false, {
			player: 0,
			move: "move",
			logLengthBefore: 0,
		});

		const result = await colls.games.findOne({ _id: gameId });
		const deadlineAfter = result?.currentPlayers?.[0].deadline?.getTime() ?? 0;
		assert.ok(
			deadlineAfter > deadlineBefore,
			`deadline should be pushed out by the increment, got ${deadlineBefore} -> ${deadlineAfter}`,
		);

		// The deadline must be consistent with the stored remainingTime: roughly
		// timerStart + remainingTime (150 + 30 increment - ~elapsed).
		const cp = result?.currentPlayers?.[0];
		const rt = result?.players[0].remainingTime ?? 0;
		assert.ok(cp?.timerStart && cp.deadline, "current player has timerStart + deadline");
		const driftMs = Math.abs(cp.deadline.getTime() - (cp.timerStart.getTime() + rt * 1000));
		assert.ok(driftMs < 2000, `deadline ≈ timerStart + remainingTime (drift ${driftMs}ms)`);
	});

	it("credits a repeat mover exactly once, charging elapsed think-time before the increment", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-repeat-exactly-once";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		// Back-date the running clock by 10s of think time.
		await colls.games.updateOne(
			{ _id: gameId },
			{ $set: { "currentPlayers.0.timerStart": new Date(Date.now() - 10000) } },
		);
		const game = await colls.games.findOne({ _id: gameId });
		assert.ok(game);

		const data = await engine.move(game.data, "move", 0);
		await afterMove(engine, game, data, false, { player: 0, move: "move", logLengthBefore: 0 });

		const rt = (await colls.games.findOne({ _id: gameId }))?.players[0].remainingTime ?? 0;
		// Charge-then-credit: 150 - ~10 elapsed + 30 increment ≈ 170. A double
		// credit would give ≈ 200; credit-then-charge would clamp the charge at
		// the Fischer cap (300) instead of the pre-move 150.
		assert.ok(
			Math.abs(rt - (150 - 10 + timePerMove)) <= 2,
			`expected remainingTime ≈ ${150 - 10 + timePerMove} (elapsed charged, then one increment), got ${rt}`,
		);
	});

	it("caps a repeat mover's credit at timePerGame (Fischer cap)", async () => {
		const engine = makeEngine();
		const gameId = "timer-game-repeat-capped";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		await colls.games.insertOne(makeGame(gameId));

		// Nearly at the cap already: 290 - ~2 elapsed + 30 would exceed 300.
		await colls.games.updateOne({ _id: gameId }, { $set: { "players.0.remainingTime": 290 } });
		const game = await colls.games.findOne({ _id: gameId });
		assert.ok(game);

		const data = await engine.move(game.data, "move", 0);
		await afterMove(engine, game, data, false, { player: 0, move: "move", logLengthBefore: 0 });

		const rt = (await colls.games.findOne({ _id: gameId }))?.players[0].remainingTime ?? 0;
		// Credited (290 - ~2 elapsed + 30 = ~318) then clamped to the cap — not
		// merely "still under the cap" (which a missing credit would also pass).
		assert.ok(rt <= timePerGame, `remainingTime must stay capped at ${timePerGame}, got ${rt}`);
		assert.ok(
			rt >= timePerGame - 1,
			`expected remainingTime ≈ ${timePerGame} (increment credited, then clamped to the cap), got ${rt}`,
		);
	});
});
