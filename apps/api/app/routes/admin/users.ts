import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { ApiError, GameInfo, GamePreferences, User } from "../../models/index.ts";
import { queryCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/search", async (ctx) => {
  const query: string = String(ctx.query.query || "");

  if (!query) {
    ctx.body = [];
  }

  const conditions =
    ctx.query.mode === "email"
      ? { "account.email": new RegExp("^" + query.toLowerCase()) }
      : { "security.slug": new RegExp("^" + query.toLowerCase()) };

  const users = await User.find(conditions, "account").lean(true).limit(queryCount(ctx));
  ctx.body = users;
});

router.post("/:userId", async (ctx) => {
  const { account } = z.object({ account: z.object({ karma: z.number() }) }).parse(ctx.request.body);
  await User.updateOne(
    { _id: ctx.params.userId },
    {
      $set: { "account.karma": account.karma },
    }
  );
  ctx.status = 200;
});

router.post("/:userId/elo/:game", async (ctx) => {
  const { value } = z.object({ value: z.number() }).parse(ctx.request.body);
  await GamePreferences.updateOne(
    { user: ctx.params.userId, game: ctx.params.game },
    { $set: { "elo.value": value } },
    { upsert: false }
  );
  ctx.status = 200;
});

router.post("/:userId/access/grant", async (ctx) => {
  const { game, version } = z.object({
    type: z.literal("game"),
    game: z.string(),
    version: z.number().int(),
  }).parse(ctx.request.body);

  const gameInfo = await (GameInfo as any).findWithVersion(game, version).lean(true);

  if (!gameInfo) {
    ctx.status = 404;
    return;
  }

  if (gameInfo.meta.public) {
    ctx.status = 200;
    return;
  }

  if (!(await User.count({ _id: ctx.params.userId }))) {
    ctx.status = 404;
    return;
  }

  await GamePreferences.updateOne(
    { user: ctx.params.userId, game },
    { $set: { "access.maxVersion": gameInfo._id.version } },
    { upsert: true }
  );
  ctx.status = 200;
});

router.post("/:userId/confirm", async (ctx) => {
  if (!(await User.count({ _id: ctx.params.userId }))) {
    return;
  }

  await User.updateOne(
    { _id: ctx.params.userId },
    { $set: { "security.confirmed": true, "security.confirmKey": null } }
  );
  ctx.status = 200;
});

router.get("/:userId/api-errors", async (ctx) => {
  if (!(await User.count({ _id: ctx.params.userId }))) {
    return;
  }

  ctx.body = await ApiError.find({ user: ctx.params.userId }).sort("-createdAt").lean(true).limit(10);
});

router.get("/infoByName/:username", async (ctx) => {
  const user = await (User as any).findByUsername(ctx.params.username);

  if (!user) {
    ctx.status = 404;
    return;
  }

  ctx.body = user;
});

export default router;
