import assert from "assert";
import { ObjectID } from "bson";
import createError from "http-errors";
import { Context } from "koa";
import Router from "koa-router";
import { Game, GamePreferences, User } from "../../models";
import { queryCount, skipCount } from "../utils";

const router = new Router<Application.DefaultState, Context>();

router.param("userId", async (userId, ctx, next) => {
  ctx.state.foundUser = await User.findById(userId);

  if (!ctx.state.foundUser) {
    throw createError(404, "User not found");
  }

  await next();
});

router.param("userName", async (userName, ctx, next) => {
  ctx.state.foundUser = await User.findByUsername(decodeURIComponent(userName));

  if (!ctx.state.foundUser) {
    throw createError(404, "User not found");
  }

  await next();
});

router.get("/infoByName/:userName", (ctx) => {
  ctx.body = ctx.state.foundUser.publicInfo();
});

router.get("/:userId/avatar", (ctx) => {
  const name = ctx.state.foundUser.account.username;

  ctx.type = "image/svg+xml";
  ctx.body = `<?xml version="1.0" encoding="utf-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="-20 -20 40 40" width="40" height="40">
    <rect x="-20" y="-20" width="40" height="40" style="fill: #ccc" />
    <text style="text-anchor: middle; dominant-baseline: central; font-size: 20px; font-weight: bold; font-family: arial" x="0" y="0">
      ${name.slice(0, 2)}
    </text>
  </svg>`;
});

router.get("/:userId/games/open", async (ctx) => {
  const conditions: Record<string, unknown> = { status: "open" };

  if (!ctx.state.user?._id?.equals(ctx.state.foundUser._id)) {
    conditions["options.meta.unlisted"] = { $ne: true };
  }

  ctx.body = await Game.findWithPlayer(ctx.state.foundUser._id)
    // @ts-ignore
    .where(conditions)
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .select(Game.basics());
});

router.get("/:userId/games/active", async (ctx) => {
  ctx.body = await Game.findWithPlayer(ctx.state.foundUser._id)
    .where("status")
    .equals("active")
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .select(Game.basics());
});

router.get("/:userId/games/current-turn", async (ctx) => {
  ctx.body = await Game.findWithPlayersTurn(ctx.state.foundUser._id).limit(queryCount(ctx)).select(Game.basics());
});

router.get("/:userId/games/(ended|closed)", async (ctx) => {
  ctx.body = await Game.findWithPlayer(ctx.state.foundUser._id)
    .where("status")
    .equals("ended")
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .select(Game.basics());
});

router.get("/:userId/games/count/:status", async (ctx) => {
  const conditions: Record<string, unknown> = (() => {
    switch (ctx.params.status) {
      case "closed":
      case "ended":
        return { status: "ended", "players._id": new ObjectID(ctx.state.foundUser._id) };
      case "dropped":
        return {
          players: {
            $elemMatch: {
              _id: new ObjectID(ctx.state.foundUser._id),
              dropped: true,
            },
          },
        };
      default:
        assert(false, "Wrong status requested: " + ctx.params.ended);
    }
  })();

  if (ctx.query.since) {
    conditions.lastMove = {
      $gte: new Date(+ctx.query.since),
    };
  }

  if (ctx.query.game) {
    conditions["game.name"] = ctx.query.game;
  }

  // console.log(conditions);

  ctx.body = await Game.count(conditions);
});

router.get("/:userId/games/elo", async (ctx) => {
  ctx.body = await GamePreferences.findWithPlayer(ctx.state.foundUser._id)
    .where("elo.games")
    .gt(0)
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .select(GamePreferences.eloProjection())
    .sort("game")
    .lean(true);
});

router.get("/:userId/games/access", async (ctx) => {
  ctx.body = await GamePreferences.find({ user: ctx.state.foundUser._id })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .sort("game")
    .select("game access")
    .lean(true);
});

export default router;
