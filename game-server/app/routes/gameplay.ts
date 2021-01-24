import assert from "assert";
import Router from "koa-router";
import Game from "../models/game";
import { loggedIn, isAdmin } from "./utils";
import { getEngine } from "../services/engines";
import locks from "mongo-locks";
import { afterMove } from "../services/game";
import { omit } from "lodash";

const router = new Router();

router.post("/:gameId/replay", isAdmin, async (ctx) => {
  let free = await locks.lock("game", ctx.params.gameId);

  try {
    const game = await Game.findById(ctx.params.gameId);

    if (!game) {
      ctx.status = 404;
      return;
    }

    const engine = await getEngine(game.game.name, game.game.version);

    assert(engine.replay, "The engine of this game does not support replaying");

    let gameData = await engine.replay(game.data);

    const toSave = engine.toSave ? engine.toSave(gameData) : gameData;

    if (toSave) {
      await afterMove(engine, game, toSave, game.status === "ended");
      ctx.status = 200;
    } else {
      ctx.status = 500;
    }
  } finally {
    free();
  }
});

router.post("/:gameId/move", loggedIn, async (ctx, next) => {
  let free = await locks.lock("game", ctx.params.gameId);
  try {
    const game = await Game.findById(ctx.params.gameId);

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

    gameData = await engine.move(gameData, ctx.request.body.move, playerIndex);

    const toSave = engine.toSave ? engine.toSave(gameData) : gameData;

    if (toSave) {
      // For fast games, we add time back every move, not just every time the current player changes
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
  } finally {
    free();
  }
});

router.get("/:gameId/log", async (ctx) => {
  const start = ctx.query.start ? +ctx.query.start : undefined;
  const end = ctx.query.end ? +ctx.query.end : undefined;

  const game = await Game.findById(ctx.params.gameId);

  if (!game) {
    ctx.status = 404;
    return;
  }

  const engine = await getEngine(game.game.name, game.game.version);

  const playerId = ctx.state.user.id;
  const playerIndex = game.players.findIndex((pl) => pl._id.equals(playerId));

  ctx.body = {
    start,
    end,
    data: engine.logSlice(game.data, { player: playerIndex, start, end }),
  };
});

router.get("/:gameId", async (ctx) => {
  const game = await Game.findById(ctx.params.gameId);

  if (!game) {
    ctx.status = 404;
    return;
  }

  if (game.status === "active") {
    const engine = await getEngine(game.game.name, game.game.version);
    const index = game.players.findIndex((pl) => pl._id.equals(ctx.state.user?.id));

    ctx.body = {
      ...game.toJSON(),
      data: engine.stripSecret ? engine.stripSecret(game.data, index === -1 ? undefined : index) : game.data,
    };
  } else {
    // Separate data from game, because mongoose removes empty objects
    ctx.body = { ...game.toJSON(), data: game.data };
  }
});

router.get("/:gameId/data", async (ctx) => {
  const game = await Game.findById(ctx.params.gameId);

  if (!game) {
    ctx.status = 404;
    return;
  }

  if (game.status === "active") {
    const engine = await getEngine(game.game.name, game.game.version);
    const index = game.players.findIndex((pl) => pl._id.equals(ctx.state.user?.id));

    ctx.body = engine.stripSecret ? engine.stripSecret(game.data, index === -1 ? undefined : index) : game.data;
  } else {
    // Separate data from game, because mongoose removes empty objects
    ctx.body = game.data;
  }
});

export default router;
