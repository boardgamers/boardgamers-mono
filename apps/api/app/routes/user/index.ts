import assert from "node:assert";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { colls } from "../../config/db.ts";
import {
  eloProjection,
  findGamesWithPlayersTurn,
  findByUsername,
  gameBasicsProjection,
  publicInfoProjection,
  userPublicInfo,
} from "../../models/index.ts";
import { queryCount, skipCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

router.param("userId", async (userId, ctx, next) => {
  ctx.state.foundUser = await colls.users.findOne({ _id: new ObjectId(userId) });

  if (!ctx.state.foundUser) {
    throw createError(404, "User not found");
  }

  await next();
});

router.param("userName", async (userName, ctx, next) => {
  ctx.state.foundUser = await findByUsername(decodeURIComponent(userName));

  if (!ctx.state.foundUser) {
    throw createError(404, "User not found");
  }

  await next();
});

router.get("/search", async (ctx) => {
  const name: string = String(ctx.query.name || "");

  if (!name) {
    ctx.body = [];
    return;
  }

  const conditions = { "security.slug": new RegExp("^" + name.toLocaleLowerCase()) };

  const usersList = await colls.users
    .find(conditions)
    .project(publicInfoProjection)
    .limit(queryCount(ctx))
    .toArray();
  ctx.body = usersList;
});

router.get("/infoByName/:userName", (ctx) => {
  ctx.body = userPublicInfo(ctx.state.foundUser);
});

router.get("/:userId/avatar", async (ctx) => {
  const account = ctx.state.foundUser.account;

  if (account.avatar === "upload") {
    const size = Number(ctx.query.size);
    const format = isNaN(size) || !size || size > 128 ? "256x256" : size > 64 ? "128x128" : "64x64";
    const item = await colls.images.findOne(
      {
        ref: ctx.state.foundUser._id,
        refType: "User",
        key: "avatar",
        [`images.${format}`]: { $exists: true },
      },
      { projection: { [`images.${format}`]: 1 } }
    );
    if (!item) {
      return;
    }

    const imageData = item.images[format];
    ctx.set("Content-Type", imageData.mime);
    ctx.body = imageData.raw;
    return;
  }

  const response = await fetch(
    `https://api.dicebear.com/9.x/${encodeURIComponent(account.avatar)}/svg?seed=${encodeURIComponent(
      account.username
    )}`
  );

  assert(response.ok, "Error when loading image");

  ctx.set("Content-Type", "image/svg+xml");
  ctx.body = response.body;
});

router.get("/:userId/games/open", async (ctx) => {
  const conditions: Record<string, unknown> = {
    "players._id": ctx.state.foundUser._id,
    status: "open",
  };

  if (!ctx.state.user?._id?.equals(ctx.state.foundUser._id)) {
    conditions["options.meta.unlisted"] = { $ne: true };
  }

  ctx.body = await colls.games
    .find(conditions)
    .sort({ lastMove: -1 })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .project(gameBasicsProjection)
    .toArray();
});

router.get("/:userId/games/active", async (ctx) => {
  ctx.body = await colls.games
    .find({ "players._id": ctx.state.foundUser._id, status: "active" })
    .sort({ lastMove: -1 })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .project(gameBasicsProjection)
    .toArray();
});

router.get("/:userId/games/current-turn", async (ctx) => {
  ctx.body = await findGamesWithPlayersTurn(ctx.state.foundUser._id)
    .limit(queryCount(ctx))
    .project(gameBasicsProjection)
    .toArray();
});

router.get("/:userId/games/(ended|closed)", async (ctx) => {
  ctx.body = await colls.games
    .find({ "players._id": ctx.state.foundUser._id, status: "ended" })
    .sort({ lastMove: -1 })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .project(gameBasicsProjection)
    .toArray();
});

router.get("/:userId/games/count/:status", async (ctx) => {
  const conditions: Record<string, unknown> = (() => {
    switch (ctx.params.status) {
      case "closed":
      case "ended":
        return { status: "ended", "players._id": ctx.state.foundUser._id };
      case "dropped":
        return {
          players: {
            $elemMatch: {
              _id: ctx.state.foundUser._id,
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

  ctx.body = await colls.games.countDocuments(conditions);
});

router.get("/:userId/games/elo", async (ctx) => {
  ctx.body = await colls.gamePreferences
    .find({
      user: ctx.state.foundUser._id,
      "elo.games": { $gt: 0 },
    })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .project(eloProjection)
    .sort({ game: 1 })
    .toArray();
});

router.get("/:userId/games/access", async (ctx) => {
  ctx.body = await colls.gamePreferences
    .find({ user: ctx.state.foundUser._id })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .sort({ game: 1 })
    .project({ game: 1, access: 1 })
    .toArray();
});

export default router;
