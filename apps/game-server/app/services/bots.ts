import { logEvent } from "@bgs/utils/log";
import { colls } from "../config/db.ts";
import env from "../config/env.ts";
import locks from "../config/locks.ts";
import type { GameData } from "../types/engine.ts";
import { delay } from "../utils/delay.ts";
import { trackedEngine } from "./engine-call-context.ts";
import { engineRunner } from "./engine-runner.ts";
import { enginePath, getEngine } from "./engines.ts";
import { afterMove } from "./game.ts";

// Small pause before each bot move so a human watching the game sees turns happen
// (and live updates arrive) instead of the whole bot sequence applying at once.
// Configurable for tests.
const BOT_MOVE_DELAY_MS = Number(process.env.BOT_MOVE_DELAY_MS) || 1500;

// Cap on moveAI calls per driver run: a buggy engine whose moveAI never un-currents
// the bot must not loop forever (the engines' own dropPlayer auto-play loops are
// unbounded, but they run trusted in-process — bot moves go through the worker).
const MAX_BOT_MOVES_PER_RUN = 50;

// One in-flight driver per game — scheduled by the move route / startNextGame while
// still holding the game lock, so a fast second trigger collapses into the run
// already queued (the driver re-reads the game fresh under the lock anyway).
const running = new Set<string>();

/**
 * Auto-play bot turns for a game. Mirrors the engines' own dropPlayer auto-play
 * pattern (`while current: G = moveAI(G, player)`): while a bot is among the current
 * players, the engine picks its move (moveAI, in the worker thread like regular
 * moves), then the normal afterMove flow runs once. A bot move can leave the same
 * bot (or another bot) current, so the driver loops until no bot is current.
 *
 * Fire-and-forget — never blocks the request that triggered it. Failure policy: if
 * the engine has no moveAI, throws, or returns unusable data, the game is left as-is
 * (bot stuck, droppable like any player) — never wedged.
 */
export function scheduleBotMoves(gameId: string): void {
	if (running.has(gameId)) {
		return;
	}
	running.add(gameId);
	void runBotMoves(gameId)
		.catch((err) => {
			logEvent("error", "botDriver", { source: "game-server", gameId, error: String(err) });
			if (!env.silent) {
				console.error(err);
			}
		})
		.finally(() => running.delete(gameId));
}

async function runBotMoves(gameId: string): Promise<void> {
	let moves = 0;

	for (;;) {
		// Human-paced: delay first, so the previous move's response + live update
		// reach clients before the bot acts.
		await delay(BOT_MOVE_DELAY_MS);

		let played = false;

		{
			await using _lock = await locks.lock("game", gameId);
			const game = await colls.games.findOne({ _id: gameId });

			if (!game || game.status !== "active") {
				return;
			}

			const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
				gameId,
				game: game.game.name,
				version: game.game.version,
			});

			// The bot to move comes from the engine's own currentPlayer (the source of
			// truth), not the stored currentPlayers: a stale stored set (e.g. naming a
			// seat that already acted) would otherwise make the driver call moveAI for a
			// seat that can't move and abort, wedging the game. afterMove re-persists
			// the correct set on the next move.
			const current = engine.currentPlayer(game.data);
			const currentSeats = new Set(
				(current === undefined ? [] : Array.isArray(current) ? current : [current]).filter(
					(seat) => seat >= 0 && seat < game.players.length,
				),
			);

			const botIndex = game.players.findIndex((pl, index) => pl.isBot && currentSeats.has(index));

			if (botIndex === -1) {
				return;
			}

			if (moves >= MAX_BOT_MOVES_PER_RUN) {
				logEvent("warn", "botDriver", { source: "game-server", gameId, error: "bot move cap reached" });
				return;
			}

			try {
				const path = await enginePath(game.game.name, game.game.version);
				const logLengthBefore = engine.logLength(game.data);
				const gameData: GameData = await engineRunner.call(game.game.name, game.game.version, path, "moveAI", [
					game.data,
					botIndex,
				]);

				if (gameData === undefined || gameData === null) {
					throw new Error("moveAI returned no data");
				}

				const toSave = engine.toSave ? engine.toSave(gameData) : gameData;
				if (toSave) {
					await afterMove(engine, game, toSave, false, { player: botIndex, move: null, logLengthBefore });
				} else {
					// The engine declined to persist the auto-played state — nothing more
					// the driver can do without wedging the game.
					throw new Error("moveAI result was not saveable (toSave returned nothing)");
				}
			} catch (err) {
				// Leave the bot stuck (it can be dropped like any player) rather than
				// retry-looping on a broken engine.
				logEvent("error", "botDriver", { source: "game-server", gameId, error: String(err) });
				if (!env.silent) {
					console.error(`Bot move failed in game ${gameId}:`, err);
				}
				return;
			}

			moves++;
			played = true;
		}

		if (!played) {
			return;
		}
	}
}
