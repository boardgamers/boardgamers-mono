import { keyBy } from "@bgs/utils/array";
import { logEvent } from "@bgs/utils/log";
import { omit, pick } from "@bgs/utils/object";
import assert from "node:assert";
import createError from "http-errors";
import { ObjectId } from "mongodb";
import Router from "koa-router";
import { z } from "zod";
import { colls } from "../config/db.ts";
import locks from "../config/locks.ts";
import { batchReplay } from "../services/batch.ts";
import { moveString, trackedEngine } from "../services/engine-call-context.ts";
import { enginePath, getEngine } from "../services/engines.ts";
import { engineRunner, EngineTimeoutError } from "../services/engine-runner.ts";
import { afterMove } from "../services/game.ts";
import { isAdmin, loggedIn } from "./utils.ts";

const router = new Router();

router.post("/batch/replay", isAdmin, async (ctx) => {
	{
		await using _lock = await locks.lock("batch-replay");
		const { gameIds } = z.object({ gameIds: z.array(z.string()) }).parse(ctx.request.body);

		ctx.body = await batchReplay({ _id: { $in: gameIds } });
	}
});

router.post("/:gameId/edit-data", isAdmin, async (ctx) => {
	{
		await using _lock = await locks.lockWait("game", ctx.params.gameId);
		const game = await colls.games.findOne({ _id: ctx.params.gameId });

		if (!game) {
			ctx.status = 404;
			return;
		}

		const { json } = z.object({ json: z.unknown() }).parse(ctx.request.body);
		await colls.games.updateOne({ _id: ctx.params.gameId }, { $set: { data: json } });

		ctx.status = 200;
	}
});

router.post("/:gameId/replay", isAdmin, async (ctx) => {
	{
		await using _lock = await locks.lockWait("game", ctx.params.gameId);
		const game = await colls.games.findOne({ _id: ctx.params.gameId });

		if (!game) {
			ctx.status = 404;
			return;
		}

		const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
			gameId: ctx.params.gameId,
			game: game.game.name,
			version: game.game.version,
		});

		// oxlint-disable-next-line typescript/unbound-method -- existence check, not a call
		assert(engine.replay, "The engine of this game does not support replaying");

		const { to } = z.object({ to: z.number().optional() }).parse(ctx.request.body);
		const gameData = await engine.replay(game.data, { to });

		const toSave = engine.toSave ? engine.toSave(gameData) : gameData;

		if (toSave) {
			await afterMove(engine, game, toSave, game.status === "ended");
			ctx.status = 200;
		} else {
			// engine.toSave returned undefined: the replayed-to state is not a clean
			// save point (e.g. powergrid's newTurn === false mid-turn). Not a server
			// fault — tell the admin which move to pick instead of a bare 500.
			throw createError(
				422,
				`Replaying to move ${to ?? "the end"} leaves the game in a non-savable state (mid-turn); pick a move that ends a turn`,
			);
		}
	}
});

router.post("/:gameId/move", loggedIn, async (ctx) => {
	{
		await using _lock = await locks.lockWait("game", ctx.params.gameId);
		const game = await colls.games.findOne({ _id: ctx.params.gameId });

		if (!game) {
			ctx.status = 404;
			return;
		}

		assert(
			game.currentPlayers?.some((pl) => pl._id.equals(ctx.state.user.id)),
			"It's not your turn to play.",
		);

		const playerId = ctx.state.user.id;
		const playerIndex = game.players.findIndex((pl) => pl._id.equals(playerId));
		const playerName = game.players[playerIndex]?.name;

		const { move } = z.object({ move: z.unknown() }).parse(ctx.request.body);

		const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
			gameId: ctx.params.gameId,
			game: game.game.name,
			version: game.game.version,
			playerIndex,
			playerName,
			move,
		});

		let gameData = game.data;

		const initialLogIndex = engine.logLength(gameData);

		// Run the move in a worker thread with a hard timeout: a runaway engine (an
		// infinite loop in move/available-moves) would otherwise wedge the whole
		// game-server event loop (the 2026-08-09 outage). The worker is terminated on
		// timeout and the move fails; the server stays responsive. See engine-runner.ts.
		try {
			const path = await enginePath(game.game.name, game.game.version);
			gameData = await engineRunner.call(game.game.name, game.game.version, path, "move", [
				gameData,
				move,
				playerIndex,
			]);
		} catch (err) {
			if (err instanceof EngineTimeoutError) {
				// Attribute the hang to the exact game/engine/action: log loudly (→ Loki)
				// AND record an apiErrors entry (meta.gameId + source) so it surfaces on the
				// admin errors page and the per-game admin page — an engine that keeps
				// timing out must be findable and flaggable, not silent.
				logEvent("error", "engineTimeout", {
					source: "game-server",
					game: game.game.name,
					version: game.game.version,
					gameId: ctx.params.gameId,
					playerIndex,
					playerName,
					move: moveString(move),
					error: err.message,
				});
				colls.apiErrors
					.insertOne({
						request: {
							url: ctx.request.originalUrl,
							method: ctx.request.method,
							body: JSON.stringify(ctx.request.body),
							status: 422,
							id: ctx.state.requestId,
						},
						error: {
							name: "EngineTimeoutError",
							message: err.message,
							stack: err.stack ? err.stack.split("\n") : [],
						},
						user: ctx.state.user?.id ? new ObjectId(ctx.state.user.id) : undefined,
						meta: {
							source: "game-server",
							gameId: ctx.params.gameId,
							// Extra attribution fields (meta is .loose()): pin the exact engine.
							game: game.game.name,
							version: game.game.version,
							action: "move",
							playerIndex,
							playerName,
							move: moveString(move),
						},
						createdAt: new Date(),
					})
					.catch(() => {});
				// 422 (not 500): the move couldn't be applied — same surface as an illegal move.
				ctx.status = 422;
				ctx.body = { message: "The game engine took too long to process this move and was stopped. Please try again." };
				return;
			}
			throw err;
		}

		const toSave = engine.toSave ? engine.toSave(gameData) : gameData;

		if (toSave) {
			// The per-move increment is credited by afterMove (single layer — see the
			// creditIncrement helper there); the route deliberately stays out of it.
			await afterMove(engine, game, toSave, false, {
				player: playerIndex,
				move,
				logLengthBefore: initialLogIndex,
			});
		}

		ctx.body = {
			game: omit(game, "data"),
			log: {
				start: initialLogIndex,
				data: engine.logSlice(gameData, { start: initialLogIndex, player: playerIndex }),
			},
		};
	}
});

router.post("/:gameId/settings", loggedIn, async (ctx) => {
	const game = await colls.games.findOne({ _id: ctx.params.gameId });

	if (!game) {
		ctx.status = 404;
		return;
	}

	const playerIndex = game.players?.findIndex((pl) => pl._id.equals(ctx.state.user.id));

	assert(playerIndex !== -1, "You're not part of this game");
	assert(game.status === "active", "You can only set settings on active games");

	const gameInfo = await colls.gameInfos.findOne(
		{ _id: { game: game.game.name, version: game.game.version } },
		{ projection: { settings: 1 } },
	);
	assert(gameInfo?.settings, "No settings registered for this game");
	const settingsMap = keyBy(gameInfo.settings, (s) => s.name);

	const filteredSettings = pick(z.record(z.string(), z.unknown()).parse(ctx.request.body), Object.keys(settingsMap));
	for (const [key, setting] of Object.entries(filteredSettings)) {
		switch (settingsMap[key].type) {
			case "checkbox":
				if (typeof setting !== "boolean") {
					delete filteredSettings[key];
				}
				break;
			case "select":
				if (!settingsMap[key].items?.some((item) => item.name === setting)) {
					delete filteredSettings[key];
				}
				break;
			default:
				delete filteredSettings[key];
		}
	}

	const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
		gameId: ctx.params.gameId,
		game: game.game.name,
		version: game.game.version,
		playerIndex,
		playerName: game.players[playerIndex]?.name,
	});

	// oxlint-disable-next-line typescript/unbound-method -- existence check, not a call
	assert(engine.setPlayerSettings, "This game does not support custom settings");

	{
		await using _lock = await locks.lockWait("game", ctx.params.gameId);
		const freshGame = await colls.games.findOne({ _id: ctx.params.gameId });
		assert(freshGame, "Game not found");

		let gameData = freshGame.data;

		gameData = engine.setPlayerSettings(gameData, playerIndex, filteredSettings);

		const toSave = engine.toSave ? engine.toSave(gameData) : gameData;

		if (toSave) {
			await colls.games.updateOne({ _id: ctx.params.gameId }, { $set: { data: JSON.parse(JSON.stringify(toSave)) } });
		}

		ctx.body = {
			settings: toSave ? engine.playerSettings(toSave, playerIndex) : null,
		};
	}
});

router.get("/:gameId/settings", loggedIn, async (ctx) => {
	const game = await colls.games.findOne({ _id: ctx.params.gameId });

	if (!game) {
		ctx.status = 404;
		return;
	}

	const playerIndex = game.players?.findIndex((pl) => pl._id.equals(ctx.state.user.id));

	assert(playerIndex !== -1, "You're not part of this game");
	assert(game.status === "active", "You can only get settings on active games");

	const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
		gameId: ctx.params.gameId,
		game: game.game.name,
		version: game.game.version,
	});

	// oxlint-disable-next-line typescript/unbound-method -- existence check, not a call
	assert(engine.playerSettings, "This game does not support custom settings");

	ctx.body = engine.playerSettings(game.data, playerIndex);
});

router.get("/:gameId/log", async (ctx) => {
	const start = ctx.query.start ? +ctx.query.start : undefined;
	const end = ctx.query.end ? +ctx.query.end : undefined;

	const game = await colls.games.findOne({ _id: ctx.params.gameId });

	if (!game) {
		ctx.status = 404;
		return;
	}

	const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
		gameId: ctx.params.gameId,
		game: game.game.name,
		version: game.game.version,
	});

	const playerId = ctx.state.user?.id;
	const playerIndex = game.players.findIndex((pl) => pl._id.equals(playerId));

	ctx.body = {
		start,
		end,
		data: engine.logSlice(game.data, { player: playerIndex, start, end }),
	};
});

router.get("/:gameId/length", async (ctx) => {
	const game = await colls.games.findOne({ _id: ctx.params.gameId });

	if (!game) {
		ctx.status = 404;
		return;
	}

	const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
		gameId: ctx.params.gameId,
		game: game.game.name,
		version: game.game.version,
	});

	ctx.body = engine.logLength(game.data);
});

router.get("/:gameId", async (ctx) => {
	const game = await colls.games.findOne({ _id: ctx.params.gameId });

	if (!ctx.state.user?.isAdmin && ctx.query.admin === "true") {
		ctx.status = 403;
		return;
	}

	if (!game) {
		ctx.status = 404;
		return;
	}

	if (game.status === "active") {
		const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
			gameId: ctx.params.gameId,
			game: game.game.name,
			version: game.game.version,
		});
		const index = game.players.findIndex((pl) => pl._id.equals(ctx.state.user?.id));

		ctx.body = {
			...game,
			data:
				engine.stripSecret && ctx.query.admin !== "true"
					? engine.stripSecret(game.data, index === -1 ? undefined : index)
					: game.data,
		};
	} else {
		ctx.body = game;
	}
});

router.get("/:gameId/data", async (ctx) => {
	const game = await colls.games.findOne({ _id: ctx.params.gameId });

	if (!game) {
		ctx.status = 404;
		return;
	}

	if (game.status === "active") {
		const engine = trackedEngine(await getEngine(game.game.name, game.game.version), {
			gameId: ctx.params.gameId,
			game: game.game.name,
			version: game.game.version,
		});
		const index = game.players.findIndex((pl) => pl._id.equals(ctx.state.user?.id));

		ctx.body = engine.stripSecret ? engine.stripSecret(game.data, index === -1 ? undefined : index) : game.data;
	} else {
		ctx.body = game.data;
	}
});

export default router;
