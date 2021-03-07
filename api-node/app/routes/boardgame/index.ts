import assert from "assert";
import createError from "http-errors";
import { Context } from "koa";
import Router from "koa-router";
import { Game, GameInfo, GamePreferences } from "../../models";
import GameInfoService from "../../services/gameinfo";
import { queryCount, skipCount } from "../utils";

const router = new Router<Application.DefaultState, Context>();

router.param("boardgame", async (boardgame, ctx, next) => {
  ctx.state.foundBoardgame = await GameInfo.findOne({ "_id.game": boardgame, "meta.public": true }).sort(
    "-_id.version"
  );

  if (!ctx.state.foundBoardgame) {
    throw createError(404, "Boardgame not found");
  }

  await next();
});

router.get("/:boardgame/games/stats", async (ctx) => {
  const boardgameName = ctx.state.foundBoardgame._id.game;
  const [active, open, total, finished] = await Promise.all([
    Game.count({ status: "active", "game.name": boardgameName }).exec(),
    Game.count({ status: "open", "game.name": boardgameName, "options.meta.unlisted": { $ne: true } }).exec(),
    Game.count({ "game.name": boardgameName }).exec(),
    Game.count({ status: "ended", "game.name": boardgameName }).exec(),
  ]);

  ctx.body = {
    active,
    open,
    total,
    finished,
  };
});

router.get("/info", async (ctx) => {
  const ownGames = ctx.state.user
    ? await GamePreferences.find(
        { user: ctx.state.user.id, "access.maxVersion": { $exists: true } },
        "game access.maxVersion",
        { lean: true }
      )
    : [];
  ctx.body = await GameInfo.find(
    {
      $or: [
        { "meta.public": true },
        ...ownGames.map((game) => ({ _id: { game: game.game, version: game.access.maxVersion } })),
      ],
    },
    "-viewer",
    { lean: true }
  ).sort("_id.game -_id.version");
});

router.get("/:boardgame", (ctx) => {
  ctx.body = ctx.state.foundBoardgame;
});

router.get("/:boardgame/info", (ctx) => {
  ctx.body = ctx.state.foundBoardgame;
});

router.get("/:boardgame/info/latest", async (ctx) => {
  const game = await GameInfoService.lastAccessibleVersion(ctx.params.boardgame, ctx.state.user);

  if (game) {
    ctx.body = game;
  } // else 404
});

router.get("/:boardgame/elo", async (ctx) => {
  const boardgameName = ctx.state.foundBoardgame._id.game;
  ctx.body = await GamePreferences.aggregate([
    {
      $match: {
        game: boardgameName,
        "elo.value": { $gt: 0 },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userData",
      },
    },
    {
      $sort: {
        "elo.value": -1,
      },
    },
    {
      $project: {
        elo: 1,
        "access.ownership": 1,
        "userData.account.username": 1,
      },
    },
  ])
    .skip(skipCount(ctx))
    .limit(queryCount(ctx));
});

router.get("/:boardgame/elo/count", async (ctx) => {
  const boardgameName = ctx.state.foundBoardgame._id.game;
  ctx.body = await GamePreferences.count({ game: boardgameName, "elo.value": { $gt: 0 } }).exec();
});

router.get("/:boardgame/games/:status", async (ctx) => {
  const conditions: Record<string, unknown> = (() => {
    switch (ctx.params.status) {
      case "active":
        return { status: "active" };
      case "closed":
        return { status: "ended" };
      case "open":
        return { status: "open", "options.meta.unlisted": { $ne: true } };
      default:
        assert(false, "Wrong status requested: " + ctx.params.ended);
    }
  })();

  if (ctx.query.user) {
    conditions["players._id"] = ctx.query.user;
  }
  ctx.body = await Game.findWithBoardgame(ctx.state.foundBoardgame._id.game)
    // @ts-ignore
    .where(conditions)
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .select(Game.basics());
});

router.get("/:boardgame/games/:status/count", async (ctx) => {
  const boardgameName = ctx.state.foundBoardgame._id.game;
  const conditions: Record<string, unknown> = (() => {
    switch (ctx.params.status) {
      case "active":
        return { "game.name": boardgameName, status: "active" };
      case "closed":
        return { "game.name": boardgameName, status: "ended" };
      case "open":
        return { "game.name": boardgameName, status: "open", "options.meta.unlisted": { $ne: true } };
      default:
        assert(false, "Wrong status requested: " + ctx.params.ended);
    }
  })();

  if (ctx.query.user) {
    conditions["players._id"] = ctx.query.user;
  }

  ctx.body = await Game.count(conditions).exec();
});

router.get("/:boardgame/info/:version", async (ctx) => {
  const game = await GameInfo.findOne({ _id: { game: ctx.params.boardgame, version: +ctx.params.version } }).lean(true);

  if (game) {
    ctx.body = game;
  } // else 404
});

export default router;
