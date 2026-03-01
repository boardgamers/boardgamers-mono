import { keyBy } from "@bgs/utils/array";
import { omit, pick } from "@bgs/utils/object";
import assert from "node:assert";
import Router from "koa-router";
import { z } from "zod";
import { colls } from "../config/db.ts";
import locks from "../config/locks.ts";
import { batchReplay } from "../services/batch.ts";
import { getEngine } from "../services/engines.ts";
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
    await using _lock = await locks.lock("game", ctx.params.gameId);
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
    await using _lock = await locks.lock("game", ctx.params.gameId);
    const game = await colls.games.findOne({ _id: ctx.params.gameId });

    if (!game) {
      ctx.status = 404;
      return;
    }

    const engine = await getEngine(game.game.name, game.game.version);

    assert(engine.replay, "The engine of this game does not support replaying");

    const { to } = z.object({ to: z.number().optional() }).parse(ctx.request.body);
    const gameData = await engine.replay(game.data, { to });

    const toSave = engine.toSave ? engine.toSave(gameData) : gameData;

    if (toSave) {
      await afterMove(engine, game, toSave, game.status === "ended");
      ctx.status = 200;
    } else {
      ctx.status = 500;
    }
  }
});

router.post("/:gameId/move", loggedIn, async (ctx) => {
  {
    await using _lock = await locks.lock("game", ctx.params.gameId);
    const game = await colls.games.findOne({ _id: ctx.params.gameId });

    if (!game) {
      ctx.status = 404;
      return;
    }

    assert(
      game.currentPlayers?.some((pl) => pl._id.equals(ctx.state.user.id)),
      "It's not your turn to play."
    );

    const engine = await getEngine(game.game.name, game.game.version);

    const playerId = ctx.state.user.id;
    const playerIndex = game.players.findIndex((pl) => pl._id.equals(playerId));

    let gameData = game.data;

    const initialLogIndex = engine.logLength(gameData);

    const { move } = z.object({ move: z.unknown() }).parse(ctx.request.body);
    gameData = await engine.move(gameData, move, playerIndex);

    const toSave = engine.toSave ? engine.toSave(gameData) : gameData;

    if (toSave) {
      if (game.options.timing.timePerMove <= 15 * 60) {
        game.players[playerIndex].remainingTime = Math.min(
          game.options.timing.timePerGame,
          (game.players[playerIndex].remainingTime ?? game.options.timing.timePerGame) + game.options.timing.timePerMove
        );
      }
      await afterMove(engine, game, toSave);
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
    { projection: { settings: 1 } }
  );
  const settingsMap = keyBy(gameInfo!.settings!, (s) => s.name);

  const filteredSettings = pick(z.record(z.string(), z.unknown()).parse(ctx.request.body), Object.keys(settingsMap));
  for (const [key, setting] of Object.entries(filteredSettings)) {
    switch (settingsMap[key].type) {
      case "checkbox":
        if (typeof setting !== "boolean") {
          delete filteredSettings[key];
        }
        break;
      case "select":
        if (!settingsMap[key].items!.some((item) => item.name === setting)) {
          delete filteredSettings[key];
        }
        break;
      default:
        delete filteredSettings[key];
    }
  }

  const engine = await getEngine(game.game.name, game.game.version);

  assert(engine.setPlayerSettings, "This game does not support custom settings");

  {
    await using _lock = await locks.lock("game", ctx.params.gameId);
    const freshGame = await colls.games.findOne({ _id: ctx.params.gameId });

    let gameData = freshGame!.data;

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

  const engine = await getEngine(game.game.name, game.game.version);

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

  const engine = await getEngine(game.game.name, game.game.version);

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

  const engine = await getEngine(game.game.name, game.game.version);

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
    const engine = await getEngine(game.game.name, game.game.version);
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
    const engine = await getEngine(game.game.name, game.game.version);
    const index = game.players.findIndex((pl) => pl._id.equals(ctx.state.user?.id));

    ctx.body = engine.stripSecret ? engine.stripSecret(game.data, index === -1 ? undefined : index) : game.data;
  } else {
    ctx.body = game.data;
  }
});

export default router;
