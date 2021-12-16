import createError from "http-errors";
import { Context } from "koa";
import Router from "koa-router";
import { GameInfo, GamePreferences } from "../../models";
import GameInfoService from "../../services/gameinfo";
import { queryCount, skipCount } from "../utils";

const router = new Router<Application.DefaultState, Context>();

router.param("boardgame", async (boardgame, ctx, next) => {
  ctx.state.foundBoardgame = await GameInfo.findOne({ "_id.game": boardgame, "meta.public": true }).sort(
    "-_id.version"
  );

  if (!ctx.state.foundBoardgame) {
    ctx.state.foundBoardgame = await GameInfoService.lastAccessibleVersion(ctx.params.boardgame, ctx.state.user);
  }

  if (!ctx.state.foundBoardgame) {
    throw createError(404, "Boardgame not found");
  }

  await next();
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
      $sort: {
        "elo.value": -1,
      },
    },
    {
      $skip: skipCount(ctx),
    },
    {
      $limit: queryCount(ctx),
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
      $unwind: "$userData",
    },
    {
      $project: {
        elo: 1,
        "access.ownership": 1,
        "user.name": "$userData.account.username",
      },
    },
  ]);
});

router.get("/:boardgame/elo/count", async (ctx) => {
  const boardgameName = ctx.state.foundBoardgame._id.game;
  ctx.body = await GamePreferences.count({ game: boardgameName, "elo.value": { $gt: 0 } }).exec();
});

router.get("/:boardgame/info/:version", async (ctx) => {
  const game = await GameInfo.findOne({ _id: { game: ctx.params.boardgame, version: +ctx.params.version } }).lean(true);

  if (game) {
    ctx.body = game;
  } // else 404
});

export default router;
