import assert from "assert";
import createError from "http-errors";
import { Context } from "koa";
import Router from "koa-router";
import { Types } from "mongoose";
import fetch from "node-fetch";
import { Game, GamePreferences, ImageCollection, User } from "../../models";
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

router.get("/search", async (ctx) => {
  const name: string = ctx.query.name || "";

  if (!name) {
    ctx.body = [];
  }

  const conditions = { "security.slug": new RegExp("^" + name.toLocaleLowerCase()) };

  const users = await User.find(conditions).select(User.publicInfo()).lean(true).limit(queryCount(ctx));
  ctx.body = users;
});

router.get("/infoByName/:userName", (ctx) => {
  ctx.body = ctx.state.foundUser.publicInfo();
});

router.get("/:userId/avatar", async (ctx) => {
  const account = ctx.state.foundUser.account;

  if (account.avatar === "upload") {
    const size = Number(ctx.query.size);
    let format = isNaN(size) || !size || size > 128 ? "256x256" : size > 64 ? "128x128" : "64x64";
    const item = await ImageCollection.findOne(
      { ref: ctx.state.foundUser._id, refType: "User", key: "avatar", [`images.${format}`]: { $exists: true } },
      { [`images.${format}`]: 1 }
    );
    if (!item) {
      return;
    }

    ctx.set("Content-Type", item.images.get(format).mime);
    ctx.body = item.images.get(format).raw;
    return;
  }

  const response = await fetch(`https://avatars.dicebear.com/api/${account.avatar}/${account.username}.svg`);

  assert(response.ok, "Error when loading image");

  ctx.set("Content-Type", "image/svg+xml");
  ctx.body = response.body;
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
        return { status: "ended", "players._id": new Types.ObjectId(ctx.state.foundUser._id) };
      case "dropped":
        return {
          players: {
            $elemMatch: {
              _id: new Types.ObjectId(ctx.state.foundUser._id),
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
