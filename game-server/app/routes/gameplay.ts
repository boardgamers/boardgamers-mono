import assert from "assert";
import Router from "koa-router";
import Game from "../models/game";
import GameInfo from "../models/gameinfo";
import { loggedIn, isAdmin } from "./utils";
import { getEngine } from "../services/engines";
import locks from "mongo-locks";
import { afterMove } from "../services/game";
import { keyBy, omit, pick } from "lodash";

const router = new Router();

router.post("/:gameId/replay", isAdmin, async (ctx) => {
  const free = await locks.lock("game", ctx.params.gameId);

  try {
    const game = await Game.findById(ctx.params.gameId);

    if (!game) {
      ctx.status = 404;
      return;
    }

    const engine = await getEngine(game.game.name, game.game.version);

    assert(engine.replay, "The engine of this game does not support replaying");

    const gameData = await engine.replay(game.data);

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

router.post("/:gameId/move", loggedIn, async (ctx) => {
  const free = await locks.lock("game", ctx.params.gameId);
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

router.post("/:gameId/settings", loggedIn, async (ctx) => {
  const game = await Game.findById(ctx.params.gameId);

  if (!game) {
    ctx.status = 404;
    return;
  }

  const playerIndex = game.players?.findIndex((pl) => pl._id.equals(ctx.state.user.id));

  assert(playerIndex !== -1, "You're not part of this game");
  assert(game.status === "active", "You can only set settings on active games");

  const gameInfo = await GameInfo.findById({ game: game.game.name, version: game.game.version })
    .select("settings")
    .lean(true);
  const settings = keyBy(gameInfo.settings, "name");

  // Make sure that the setting is well-formed
  // could throw a BadRequestException instead
  const filteredSettings = pick(ctx.request.body, Object.keys(settings));
  for (const [key, setting] of Object.entries(filteredSettings)) {
    switch (settings[key].type) {
      case "checkbox":
        if (typeof setting !== "boolean") {
          delete filteredSettings[key];
        }
        break;
      case "select":
        if (!settings[key].items.some((item) => item.name === setting)) {
          delete filteredSettings[key];
        }
        break;
      default:
        delete filteredSettings[key];
    }
  }

  const engine = await getEngine(game.game.name, game.game.version);

  assert(engine.setPlayerSettings, "This game does not support custom settings");

  const free = await locks.lock("game", ctx.params.gameId);
  try {
    const game = await Game.findById(ctx.params.gameId);

    let gameData = game.data;

    gameData = engine.setPlayerSettings(gameData, playerIndex, filteredSettings);

    const toSave = engine.toSave ? engine.toSave(gameData) : gameData;

    if (toSave) {
      game.data = toSave;
      game.markModified("data");
    }

    await game.save();

    ctx.body = {
      settings: toSave ? engine.playerSettings(toSave, playerIndex) : null,
    };
  } finally {
    free();
  }
});

router.get("/:gameId/settings", loggedIn, async (ctx) => {
  const game = await Game.findById(ctx.params.gameId);

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
