import assert from "node:assert";
import createError from "http-errors";
import type { Context } from "koa";
import Router from "koa-router";
import { type Binary, ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import {
  eloProjection,
  findGamesWithPlayersTurn,
  findByUsername,
  gameBasicsProjection,
  publicInfoProjection,
  userPublicInfo,
} from "../../models/index.ts";
import { zIntQuery } from "../../utils/zod.ts";
import { queryCount, skipCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

router.param("userId", async (userId, ctx, next) => {
  ctx.state.foundUser = (await colls.users.findOne({ _id: new ObjectId(userId) })) ?? undefined;

  if (!ctx.state.foundUser) {
    throw createError(404, "User not found");
  }

  await next();
});

router.param("userName", async (userName, ctx, next) => {
  ctx.state.foundUser = (await findByUsername(decodeURIComponent(userName))) ?? undefined;

  if (!ctx.state.foundUser) {
    throw createError(404, "User not found");
  }

  await next();
});

router.get("/search", async (ctx) => {
  const { name } = z.object({ name: z.string().optional() }).parse(ctx.query);

  if (!name) {
    ctx.body = [];
    return;
  }

  const conditions = { "security.slug": new RegExp("^" + name.toLocaleLowerCase()) };

  const usersList = await colls.users.find(conditions).project(publicInfoProjection).limit(queryCount(ctx)).toArray();
  ctx.body = usersList;
});

router.get("/infoByName/:userName", (ctx) => {
  ctx.body = userPublicInfo(ctx.state.foundUser!);
});

router.get("/:userId/avatar", async (ctx) => {
  const foundUser = ctx.state.foundUser!;
  const account = foundUser.account;
  const { size } = z.object({ size: zIntQuery().optional() }).parse(ctx.query);

  if (account.avatar === "upload") {
    const format = !size || size > 128 ? "256x256" : size > 64 ? "128x128" : "64x64";
    const item = await colls.images.findOne(
      {
        ref: foundUser._id,
        refType: "User",
        key: "avatar",
        [`images.${format}`]: { $exists: true },
      },
      { projection: { [`images.${format}`]: 1 } },
    );
    if (!item) {
      return;
    }

    const imageData = item.images[format];
    ctx.set("Content-Type", imageData.mime);
    // The driver returns binary fields as BSON Binary, which Koa doesn't treat
    // as a buffer and base64-encodes as JSON. Hand it a Node Buffer instead.
    ctx.body = Buffer.isBuffer(imageData.raw) ? imageData.raw : Buffer.from((imageData.raw as Binary).buffer);
    return;
  }

  const response = await fetch(
    `https://api.dicebear.com/9.x/${encodeURIComponent(account.avatar ?? "avataaars")}/svg?seed=${encodeURIComponent(
      account.username,
    )}`,
  );

  assert(response.ok, "Error when loading image");

  ctx.set("Content-Type", "image/svg+xml");
  // Buffer the SVG: Koa only streams Node streams, so handing it fetch()'s WHATWG
  // ReadableStream falls through to JSON.stringify and serializes as `{}`.
  ctx.body = Buffer.from(await response.arrayBuffer());
});

router.get("/:userId/games/open", async (ctx) => {
  const foundUser = ctx.state.foundUser!;
  const conditions: Record<string, unknown> = {
    "players._id": foundUser._id,
    status: "open",
  };

  if (!ctx.state.user?._id?.equals(foundUser._id)) {
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
    .find({ "players._id": ctx.state.foundUser!._id, status: "active" })
    .sort({ lastMove: -1 })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .project(gameBasicsProjection)
    .toArray();
});

router.get("/:userId/games/current-turn", async (ctx) => {
  ctx.body = await findGamesWithPlayersTurn(ctx.state.foundUser!._id)
    .limit(queryCount(ctx))
    .project(gameBasicsProjection)
    .toArray();
});

router.get("/:userId/games/(ended|closed)", async (ctx) => {
  ctx.body = await colls.games
    .find({ "players._id": ctx.state.foundUser!._id, status: "ended" })
    .sort({ lastMove: -1 })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .project(gameBasicsProjection)
    .toArray();
});

const gameCountParamsSchema = z.object({
  status: z.enum(["closed", "ended", "dropped"]),
});

const gameCountQuerySchema = z.object({
  since: zIntQuery().optional(),
  game: z.string().optional(),
});

router.get("/:userId/games/count/:status", async (ctx) => {
  const foundUser = ctx.state.foundUser!;
  const { status } = gameCountParamsSchema.parse(ctx.params);
  const { since, game } = gameCountQuerySchema.parse(ctx.query);
  const conditions: Record<string, unknown> = (() => {
    switch (status) {
      case "closed":
      case "ended":
        return { status: "ended", "players._id": foundUser._id };
      case "dropped":
        return {
          players: {
            $elemMatch: {
              _id: foundUser._id,
              dropped: true,
            },
          },
        };
    }
  })();

  if (since !== undefined) {
    conditions.lastMove = {
      $gte: new Date(since),
    };
  }

  if (game) {
    conditions["game.name"] = game;
  }

  ctx.body = await colls.games.countDocuments(conditions);
});

router.get("/:userId/games/elo", async (ctx) => {
  ctx.body = await colls.gamePreferences
    .find({
      user: ctx.state.foundUser!._id,
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
    .find({ user: ctx.state.foundUser!._id })
    .skip(skipCount(ctx))
    .limit(queryCount(ctx))
    .sort({ game: 1 })
    .project({ game: 1, access: 1 })
    .toArray();
});

export default router;
