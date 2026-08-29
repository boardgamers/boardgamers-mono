import type { GameDoc, GameNotificationDoc } from "@bgs/models";
import { deadline, elapsedSeconds } from "@bgs/utils/time";
import assert from "node:assert";
import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { colls } from "../config/db.ts";
import locks from "../config/locks.ts";
import env from "../config/env.ts";
import type { Engine, GameData } from "../types/engine.ts";
import { scheduleBotMoves } from "./bots.ts";
import { trackedEngine } from "./engine-call-context.ts";
import { getEngine } from "./engines.ts";

export async function handleMessages(engine: Engine, gameId: string, gameData: GameData): Promise<GameData> {
	if (engine.messages) {
		const ret = engine.messages(gameData);

		for (const message of ret.messages) {
			await colls.chatMessages.insertOne({
				_id: new ObjectId(),
				room: gameId,
				type: "system",
				data: { text: message },
			});
		}

		return ret.data;
	}

	return gameData;
}

export async function addMessage(gameId: string, message: string) {
	await colls.chatMessages.insertOne({ _id: new ObjectId(), room: gameId, type: "system", data: { text: message } });
}

export async function startNextGame(): Promise<boolean> {
	const notification = await colls.gameNotifications.findOne({ kind: "gameStarted", processed: false });

	if (!notification) {
		return false;
	}

	try {
		{
			await using _lock = await locks.lock("game", notification.game);

			const game = await colls.games.findOne({ _id: notification.game });

			if (!game || game.status !== "open" || game.players.length < game.options.setup.nbPlayers) {
				await colls.gameNotifications.updateOne(
					{ _id: notification._id },
					{ $set: { processed: true, updatedAt: new Date() } },
				);
				return true;
			}

			const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
				gameId: game._id,
				game: game.game.name,
				version: game.game.version,
			});

			let seed = game.options.setup.seed;

			if (engine.stripSecret) {
				seed = crypto.createHash("sha256").update(seed).update(env.seedEncryptionKey).digest().toString("base64");
			}

			const creator = game.players.findIndex((pl) => pl._id.equals(game.creator));

			let gameData = await engine.init(
				game.options.setup.nbPlayers,
				game.game.expansions,
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine options are a plain record
				(game.game.options as Record<string, unknown>) || {},
				seed,
				creator === -1 ? undefined : creator,
			);

			if (engine.setPlayerMetaData) {
				for (let i = 0; i < game.options.setup.nbPlayers; i++) {
					gameData = engine.setPlayerMetaData(gameData, i, { name: game.players[i].name });
				}
			}

			game.data = gameData;
			game.status = "active";

			const currentPlayers: number[] = (() => {
				const current = engine.currentPlayer(gameData) ?? [];
				return Array.isArray(current) ? current : [current];
			})();

			const { timePerGame, timer } = game.options.timing;
			assert(timePerGame !== undefined, "timePerGame is required for timed games");

			game.currentPlayers = currentPlayers.map((playerNumber) => {
				const player = game.players[playerNumber];
				assert(player, `No player at index ${playerNumber}`);
				return {
					_id: player._id,
					timerStart: new Date(),
					deadline: deadline(player.remainingTime ?? timePerGame, timer),
				};
			});

			game.lastMove = new Date();
			game.lastMoveInfo = null;

			if (engine.round) {
				const round = engine.round(gameData);
				if (round !== undefined) {
					game.context = { ...game.context, round };
				}
			}

			game.data = JSON.parse(JSON.stringify(game.data));
			await colls.games.replaceOne({ _id: game._id }, game);

			const now = new Date();
			const promises = (game.currentPlayers ?? [])
				// Bots don't get turn notifications (no account, no emails) — they auto-play.
				.filter((pl) => !game.players.some((p) => p._id.equals(pl._id) && p.isBot))
				.map((pl) =>
					colls.gameNotifications.insertOne({
						user: pl._id,
						createdAt: now,
						updatedAt: now,
						game: game._id,
						kind: "currentMove",
						processed: false,
					}),
				);
			await Promise.all([
				...promises,
				colls.gameNotifications.updateOne(
					{ _id: notification._id },
					{ $set: { processed: true, updatedAt: new Date() } },
				),
			]);

			scheduleBotMoves(game._id);

			return true;
		}
	} catch (err) {
		console.error(err);
		return false;
	}
}

export async function processQuit(notification: GameNotificationDoc) {
	try {
		{
			await using _lock = await locks.lock("game", notification.game);

			const game = await colls.games.findOne({ _id: notification.game });

			if (!game || game.status !== "active") {
				await colls.gameNotifications.updateOne(
					{ _id: notification._id },
					{ $set: { processed: true, updatedAt: new Date() } },
				);
				return true;
			}

			const player = game.players.find((pl) => pl._id.equals(notification.user));

			if (!player || player.dropped || player.quit) {
				await colls.gameNotifications.updateOne(
					{ _id: notification._id },
					{ $set: { processed: true, updatedAt: new Date() } },
				);
				return true;
			}

			const playerIndex = game.players.findIndex((pl) => pl._id.equals(player._id));
			const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
				gameId: game._id,
				game: game.game.name,
				version: game.game.version,
				playerIndex,
				playerName: player.name,
			});

			let gameData = game.data;

			gameData = await engine.dropPlayer(gameData, playerIndex);
			if (notification.kind === "playerQuit") {
				player.quit = true;
			} else {
				player.dropped = true;
			}

			colls.chatMessages
				.insertOne({
					_id: new ObjectId(),
					room: game._id,
					type: "system",
					data: {
						text:
							notification.kind === "playerQuit"
								? `${player.name} quit the game`
								: `${player.name} was dropped from the game`,
					},
				})
				.catch(console.error);

			if (engine.toSave) {
				gameData = engine.toSave(gameData);
			}

			if (gameData) {
				await afterMove(engine, game, gameData);

				if (notification.kind === "dropPlayer") {
					const dropPn = new Date();
					colls.gameNotifications
						.insertOne({
							kind: "playerDrop",
							game: notification.game,
							user: notification.user,
							processed: false,
							createdAt: dropPn,
							updatedAt: dropPn,
						})
						.catch(console.error);
				}
			}
			await colls.gameNotifications.updateOne(
				{ _id: notification._id },
				{ $set: { processed: true, updatedAt: new Date() } },
			);

			return true;
		}
	} catch (err) {
		console.error(err);
		return false;
	}
}

const LAST_MOVE_MAX_LEN = 80;

// Raw move notation, used when the log slice yields no readable line. Bots
// auto-play without a move argument (moveAI takes none) → "".
function moveNotation(move: unknown): string {
	if (typeof move === "string") {
		return move;
	}
	if (move === null || move === undefined) {
		return "";
	}
	return JSON.stringify(move);
}

// A single log entry → plain text, or "" to skip it. Log entries' shape is
// engine-specific: gaia uses plain strings, powergrid/container entries carry a
// plain-text `simple` field, others may use `message`/`text`/`log`. `event` /
// `phase` entries are engine phase noise (not the move) — skipped. An entry
// with no usable text falls back to a compact stringify of itself.
function logEntryText(entry: unknown): string {
	if (typeof entry === "string") {
		return entry;
	}
	if (entry && typeof entry === "object" && !Array.isArray(entry)) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- log entries are engine-defined; probed defensively
		const record = entry as Record<string, unknown>;
		if (record.type === "event" || record.type === "phase") {
			return "";
		}
		for (const key of ["simple", "message", "text", "log"]) {
			const value: unknown = record[key];
			if (typeof value === "string" && value) {
				return value;
			}
		}
		return JSON.stringify(entry);
	}
	return String(entry);
}

// logSlice returns { log: [...] } on the engines in the platform contract, but
// the type is `unknown` — pull the entries array out defensively.
function logEntries(slice: unknown): unknown[] {
	if (Array.isArray(slice)) {
		return slice;
	}
	if (slice && typeof slice === "object" && "log" in slice) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- logSlice shape is engine-defined; guarded by Array.isArray
		const log = (slice as Record<string, unknown>).log;
		if (Array.isArray(log)) {
			return log;
		}
	}
	return [];
}

// Human-readable summary of the last move: the newest log line the move
// produced (what the viewer shows), bounded to LAST_MOVE_MAX_LEN chars.
// Falls back to the raw move notation when the log slice yields nothing
// (engine produced no new entries). A move can append several entries
// (auto-moves, event+move mixes) — the newest is the most descriptive.
function lastMoveText(engine: Engine, gameData: GameData, beforeLen: number, move: unknown): string {
	try {
		const afterLen = engine.logLength(gameData);
		if (afterLen > beforeLen) {
			// Omit `end`: the slice is identical (start..logLength), and passing it would
			// make powergrid/container/take6 replay the game to recompute historical
			// availableMoves — pointless here (we only want the log lines).
			const entries = logEntries(engine.logSlice(gameData, { start: beforeLen }));
			for (let i = entries.length - 1; i >= 0; i--) {
				const text = logEntryText(entries[i]).trim();
				if (text) {
					return text.length > LAST_MOVE_MAX_LEN ? text.slice(0, LAST_MOVE_MAX_LEN - 1) + "…" : text;
				}
			}
		}
	} catch {
		// A misbehaving logSlice/logLength must never break the move — fall back below.
	}
	const raw = moveNotation(move);
	return raw.length > LAST_MOVE_MAX_LEN ? raw.slice(0, LAST_MOVE_MAX_LEN - 1) + "…" : raw;
}

export async function afterMove(
	engine: Engine,
	game: GameDoc,
	gameData: GameData,
	alreadyEnded = false,
	lastMove?: { player: number; move: unknown; logLengthBefore?: number },
) {
	// No-op when the caller already passed a tracked engine (its more specific
	// attribution — acting player + raw move — wins).
	engine = trackedEngine(engine, {
		gameId: game._id,
		game: game.game.name,
		version: game.game.version,
		playerIndex: lastMove?.player,
		playerName: lastMove === undefined ? undefined : game.players[lastMove.player]?.name,
		move: lastMove?.move,
	});

	const oldPlayers = game.currentPlayers ?? [];
	const { timePerGame, timePerMove, timer } = game.options.timing;

	gameData = await handleMessages(engine, game._id, gameData);

	if (engine.round) {
		const round = engine.round(gameData);
		if (round !== undefined) {
			game.context = { ...game.context, round };
		}
	}

	if (
		(engine.cancelled && engine.cancelled(gameData)) ||
		// Cancel vote: bots auto-consent (no one can act for a bot), and overdue
		// players — droppable like the api's /drop route requires (current, deadline
		// elapsed) — count as having voted (#403). The `some` guard keeps an all-bot
		// or all-overdue game from cancelling itself: a vote only exists once a
		// human voted/dropped/quit.
		(game.players.some((pl) => !pl.isBot && (pl.dropped || pl.quit || pl.voteCancel)) &&
			game.players.every(
				(pl) =>
					pl.dropped ||
					pl.quit ||
					pl.voteCancel ||
					pl.isBot ||
					oldPlayers.some((cp) => cp._id.equals(pl._id) && cp.deadline && cp.deadline.getTime() < Date.now()),
			))
	) {
		game.currentPlayers = [];
		game.status = "ended";
		game.cancelled = true;
		await addMessage(game._id, "Game cancelled");
	} else if (engine.ended(gameData)) {
		game.currentPlayers = [];
		game.status = "ended";
		await addMessage(game._id, "Game ended");
	} else {
		const currentPlayers: number[] = (() => {
			const current = engine.currentPlayer(gameData) ?? [];
			return Array.isArray(current) ? current : [current];
		})();
		game.currentPlayers = currentPlayers.map((playerNumber) => {
			const player = game.players[playerNumber];
			assert(player, `No player at index ${playerNumber}`);
			const oldPlayer = oldPlayers.find((p) => p._id.equals(player._id));
			if (oldPlayer) {
				// Mover is still current (issue #12): charge elapsed think-time, then
				// restart clock + deadline from the already-incremented remainingTime,
				// else the deadline stays frozen and they get dropped mid-game.
				player.remainingTime = Math.max(
					(player.remainingTime ?? timePerGame ?? 0) - elapsedSeconds(oldPlayer.timerStart, timer),
					0,
				);
				return {
					_id: player._id,
					timerStart: new Date(),
					deadline: deadline(player.remainingTime, timer),
				};
			}
			return {
				_id: player._id,
				timerStart: new Date(),
				deadline: deadline(player.remainingTime ?? timePerGame ?? 0, timer),
			};
		});
	}
	const scores = engine.scores(gameData);
	const factions = engine.factions?.(gameData);

	if (scores) {
		assert(scores.length === game.players.length);
		scores.forEach((score, i) => (game.players[i].score = score));
	}

	if (game.status === "ended") {
		let rankings = engine.rankings?.(gameData);

		if (!rankings) {
			const sortedScores = [...scores].toSorted((a, b) => b - a);
			rankings = scores.map((x) => sortedScores.indexOf(x) + 1);
		}

		rankings.forEach((ranking, i) => (game.players[i].ranking = ranking));
	}

	if (factions) {
		assert(factions.length === game.players.length);
		factions.forEach((faction, i) => (game.players[i].faction = faction));
	}

	if (!engine.ended(gameData)) {
		for (const oldPlayer of oldPlayers.filter((pl) => !game.currentPlayers?.some((pl2) => pl2._id.equals(pl._id)))) {
			const player = game.players.find((pl) => pl._id.equals(oldPlayer._id));
			if (!player) {
				continue;
			}
			player.remainingTime = (player.remainingTime ?? timePerGame ?? 0) - elapsedSeconds(oldPlayer.timerStart, timer);

			if (!player.dropped) {
				player.remainingTime += timePerMove ?? 0;

				player.remainingTime = Math.max(
					Math.min(timePerGame ?? player.remainingTime, player.remainingTime),
					timePerMove ?? 0,
				);
			}
		}
	}

	game.lastMove = new Date();
	delete game.cancelWarn;
	game.data = JSON.parse(JSON.stringify(gameData));

	if (lastMove !== undefined) {
		const player = game.players[lastMove.player];
		assert(player, `No player at index ${lastMove.player}`);
		game.lastMoveInfo = {
			player: player._id,
			move: lastMoveText(engine, gameData, lastMove.logLengthBefore ?? engine.logLength(gameData), lastMove.move),
			at: game.lastMove,
			moveNumber: engine.logLength(gameData),
		};
	} else if (game.lastMoveInfo) {
		// No lastMove (engine replay / data edit): keep the prior lastMoveInfo's
		// player/move/at, but resync moveNumber to the state's actual log length —
		// a replay rewinds the game, leaving the stored count stale.
		game.lastMoveInfo.moveNumber = engine.logLength(gameData);
	}

	// withAutoUpdatedAt stamps a *copy*, so read the stored `updatedAt` back: the move
	// route returns `game` to the client, which compares it against ws pushes — a stale
	// stamp makes the client's own echo look like an external update.
	const stored = await colls.games.findOneAndReplace({ _id: game._id }, game, {
		returnDocument: "after",
		projection: { updatedAt: 1 },
	});
	if (stored?.updatedAt) {
		game.updatedAt = stored.updatedAt;
	}

	const amNow = new Date();
	for (const player of game.currentPlayers ?? []) {
		// Bots don't get turn notifications (no account, no emails) — they auto-play.
		if (game.players.some((pl) => pl._id.equals(player._id) && pl.isBot)) {
			continue;
		}
		await colls.gameNotifications.insertOne({
			user: player._id,
			createdAt: amNow,
			updatedAt: amNow,
			game: game._id,
			kind: "currentMove",
			processed: false,
		});
	}
	if (game.status === "ended" && !alreadyEnded) {
		await colls.gameNotifications.insertOne({
			game: game._id,
			kind: "gameEnded",
			processed: false,
			createdAt: amNow,
			updatedAt: amNow,
		});
	}

	// Auto-play bot turns (no-op when no bot is the current player). Runs detached,
	// after this move's response went out, and re-acquires the game lock itself.
	if (game.status === "active" && game.currentPlayers?.length) {
		scheduleBotMoves(game._id);
	}
}
