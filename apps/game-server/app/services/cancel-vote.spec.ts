// Issue #403: "Overdue (can be dropped) players should count as having voted
// cancel." If at least one player voted cancel, and all the remaining players
// are bots, voted cancel, dropped or overdue (current + deadline elapsed, i.e.
// droppable via the api's /drop route), the game is cancelled.
//
// Run via `pnpm test` (needs a Mongo db, see AGENTS.md), NOT bare `node --test`.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { ObjectId } from "mongodb";
import type { GameDoc, PlayerInfo } from "@bgs/models";
import { colls, closeDb } from "../config/db.ts";
import { afterMove } from "./game.ts";
import type { Engine, GameData } from "../types/engine.ts";

interface CancelData {
	moves: number;
}

// Minimal engine: player 0 moves, the last player stays current forever (their
// clock expires while they stall). Never ends on its own.
function makeEngine(nbPlayers: number): Engine {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine data shape is defined by this fixture engine
	const moves = (data: GameData) => (data as CancelData).moves;
	return {
		init: async () => ({ moves: 0 }),
		move: async (data) => ({ moves: moves(data) + 1 }),
		ended: () => false,
		scores: () => Array(nbPlayers).fill(0),
		dropPlayer: async (data) => data,
		currentPlayer: () => nbPlayers - 1,
		logLength: (data) => moves(data),
		logSlice: () => ({ log: [], availableMoves: [] }),
		setPlayerMetaData: (data) => data,
		setPlayerSettings: (data) => data,
		playerSettings: () => ({}),
		rankings: () => Array.from({ length: nbPlayers }, (_, i) => i + 1),
		round: () => 0,
		cancelled: () => false,
		factions: () => Array.from({ length: nbPlayers }, (_, i) => `p${i}`),
		messages: (data) => ({ messages: [], data }),
		replay: (data) => data,
		stats: () => ({}),
	};
}

function makePlayer(name: string, extra: Partial<PlayerInfo> = {}): PlayerInfo {
	return { _id: new ObjectId(), remainingTime: 300, score: 0, dropped: false, quit: false, name, ...extra };
}

function makeGame(gameId: string, players: PlayerInfo[], currentPlayers: GameDoc["currentPlayers"]): GameDoc {
	const game = {
		_id: gameId,
		players,
		creator: players[0]._id,
		currentPlayers,
		data: { moves: 0 },
		context: { round: 0 },
		options: {
			setup: { seed: gameId, nbPlayers: players.length, playerOrder: "join" },
			timing: { timePerGame: 300, timePerMove: 30, timer: { start: 0, end: 86400 } },
		},
		game: { name: "cancel-test", version: 1, expansions: [] },
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

const overdueEntry = (id: ObjectId) => ({
	_id: id,
	timerStart: new Date(Date.now() - 3600_000),
	deadline: new Date(Date.now() - 60_000),
});

async function runMove(gameId: string) {
	const game = await colls.games.findOne({ _id: gameId });
	assert.ok(game);
	const engine = makeEngine(game.players.length);
	const data = await engine.move(game.data, "move", 0);
	await afterMove(engine, game, data, false, { player: 0, move: "move", logLengthBefore: 0 });
	return colls.games.findOne({ _id: gameId });
}

describe("afterMove cancel-vote tally — overdue players count as votes (#403)", () => {
	after(async () => {
		await closeDb();
	});

	it("cancels when one player voted and the only other player is overdue", async () => {
		const gameId = "cancel-403-overdue";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		const voter = makePlayer("voter", { voteCancel: true });
		const stalled = makePlayer("stalled");
		await colls.games.insertOne(makeGame(gameId, [voter, stalled], [overdueEntry(stalled._id)]));

		const game = await runMove(gameId);
		assert.strictEqual(game?.status, "ended", "The overdue player counts as having voted cancel");
		assert.strictEqual(game?.cancelled, true);
		assert.deepStrictEqual(game?.currentPlayers, []);
	});

	it("does not cancel when the other player is current but their deadline is still running", async () => {
		const gameId = "cancel-403-healthy";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		const voter = makePlayer("voter", { voteCancel: true });
		const active = makePlayer("active");
		await colls.games.insertOne(
			makeGame(
				gameId,
				[voter, active],
				[{ _id: active._id, timerStart: new Date(), deadline: new Date(Date.now() + 3600_000) }],
			),
		);

		const game = await runMove(gameId);
		assert.strictEqual(game?.status, "active", "A non-overdue active player still blocks the cancel");
		assert.strictEqual(game?.cancelled, false);
	});

	it("does not cancel when no player voted, even if everyone else is overdue", async () => {
		const gameId = "cancel-403-no-vote";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		const p0 = makePlayer("p0");
		const stalled = makePlayer("stalled");
		await colls.games.insertOne(makeGame(gameId, [p0, stalled], [overdueEntry(stalled._id)]));

		const game = await runMove(gameId);
		assert.strictEqual(game?.status, "active", "Overdue players only imply votes — a real vote is required");
		assert.strictEqual(game?.cancelled, false);
	});

	it("does not cancel when the only vote came from the overdue player themselves", async () => {
		// The trigger must be a vote from a player who isn't overdue/dropped/bot —
		// otherwise a player who voted then went inactive would single-handedly
		// cancel the game.
		const gameId = "cancel-403-overdue-voter";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		const p0 = makePlayer("p0");
		const stalledVoter = makePlayer("stalled-voter", { voteCancel: true });
		await colls.games.insertOne(makeGame(gameId, [p0, stalledVoter], [overdueEntry(stalledVoter._id)]));

		const game = await runMove(gameId);
		assert.strictEqual(game?.status, "active", "An overdue player's vote alone doesn't trigger the cancel");
		assert.strictEqual(game?.cancelled, false);
	});

	it("a move clears the inactivity warning markers (#94: cancelWarn and dropWarn)", async () => {
		const gameId = "cancel-94-warn-reset";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		const p0 = makePlayer("p0");
		const p1 = makePlayer("p1");
		const doc = makeGame(gameId, [p0, p1], [overdueEntry(p1._id)]);
		doc.cancelWarn = true;
		doc.dropWarn = true;
		doc.dropWarnAt = new Date();
		await colls.games.insertOne(doc);

		const game = await runMove(gameId);
		assert.strictEqual(game?.status, "active");
		assert.strictEqual(game?.cancelWarn, undefined, "the move resets the stall episode (api sweep re-warns)");
		assert.strictEqual(game?.dropWarn, undefined);
		assert.strictEqual(game?.dropWarnAt, undefined);
	});

	it("cancels when a voter dropped and the remaining player is overdue", async () => {
		const gameId = "cancel-403-drop-overdue";
		await colls.games.deleteMany({ _id: gameId });
		await colls.gameNotifications.deleteMany({ game: gameId });
		const voter = makePlayer("voter", { voteCancel: true });
		const dropped = makePlayer("dropped", { dropped: true });
		const stalled = makePlayer("stalled");
		await colls.games.insertOne(makeGame(gameId, [voter, dropped, stalled], [overdueEntry(stalled._id)]));

		const game = await runMove(gameId);
		assert.strictEqual(game?.status, "ended", "Dropped + overdue + one real vote cancels the game");
		assert.strictEqual(game?.cancelled, true);
	});
});
