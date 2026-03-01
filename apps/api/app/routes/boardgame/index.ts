import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { colls } from "../../config/db.ts";
import GameInfoService from "../../services/gameinfo.ts";
import { queryCount, skipCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

router.param("boardgame", async (boardgame, ctx, next) => {
  ctx.state.foundBoardgame = await colls.gameInfos.findOne(
    { "_id.game": boardgame, "meta.public": true },
    { sort: { "_id.version": -1 } }
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
    ? await colls.gamePreferences
        .find({
          user: ctx.state.user._id,
          "access.maxVersion": { $exists: true },
        })
        .project({ game: 1, "access.maxVersion": 1 })
        .toArray()
    : [];
  ctx.body = await colls.gameInfos
    .find({
      $or: [
        { "meta.public": true },
        ...ownGames.map((game) => ({ _id: { game: game.game, version: game.access.maxVersion } })),
      ],
    })
    .project({ viewer: 0 })
    .sort({ "_id.game": 1, "_id.version": -1 })
    .toArray();
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
  ctx.body = await colls.gamePreferences
    .aggregate([
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
          "user._id": "$userData._id",
        },
      },
    ])
    .toArray();
});

router.get("/:boardgame/elo/count", async (ctx) => {
  const boardgameName = ctx.state.foundBoardgame._id.game;
  ctx.body = await colls.gamePreferences.countDocuments({ game: boardgameName, "elo.value": { $gt: 0 } });
});

router.get("/:boardgame/info/:version", async (ctx) => {
  const game = await colls.gameInfos.findOne({
    _id: { game: ctx.params.boardgame, version: +ctx.params.version },
  });

  if (game) {
    ctx.body = game;
  } // else 404
});

export default router;
