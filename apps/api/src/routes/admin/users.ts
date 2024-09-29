import assert from "assert";
import type { Context } from "koa";
import Router from "koa-router";
import { ApiError, GameInfoUtils, GamePreferences, UserUtils } from "../../models";
import { queryCount } from "../utils";
import { collections } from "../../config/db";
import { omit } from "lodash";

const router = new Router<Application.DefaultState, Context>();

router.get("/search", async (ctx) => {
  const query: string = ctx.query.query || "";

  if (!query) {
    ctx.body = [];
  }

  const conditions =
    ctx.query.mode === "email"
      ? { "account.email": new RegExp("^" + query.toLowerCase()) }
      : { "security.slug": new RegExp("^" + query.toLowerCase()) };

  const users = await collections.users.find(conditions).project({ account: 1 }).limit(queryCount(ctx)).toArray();
  ctx.body = users.map((user) => omit(user, "account.password"));
});

router.post("/:userId", async (ctx) => {
  await collections.users.updateOne(
    { _id: ctx.params.userId },
    {
      $set: { "account.karma": ctx.request.body.account.karma },
    }
  );
  ctx.status = 200;
});

router.post("/:userId/elo/:game", async (ctx) => {
  await GamePreferences.updateOne(
    { user: ctx.params.userId, game: ctx.params.game },
    { $set: { "elo.value": ctx.request.body.value } },
    { upsert: false }
  );
  ctx.status = 200;
});

router.post("/:userId/access/grant", async (ctx) => {
  const type = ctx.request.body?.type;

  assert(type === "game", "Wrong kind of access");

  const gameInfo = await GameInfoUtils.findWithVersion(ctx.request.body.game, ctx.request.body.version);

  if (!gameInfo) {
    ctx.status = 404;
    return;
  }

  if (gameInfo.meta.public) {
    ctx.status = 200;
    return;
  }

  if (!(await collections.users.countDocuments({ _id: ctx.params.userId }, { limit: 1 }))) {
    ctx.status = 404;
    return;
  }

  await GamePreferences.updateOne(
    { user: ctx.params.userId, game: ctx.request.body.game },
    { $set: { "access.maxVersion": gameInfo._id.version } },
    { upsert: true }
  );
  ctx.status = 200;
});

router.post("/:userId/confirm", async (ctx) => {
  if (!(await collections.users.countDocuments({ _id: ctx.params.userId }, { limit: 1 }))) {
    return;
  }

  await collections.users.updateOne(
    { _id: ctx.params.userId },
    { $set: { "security.confirmed": true, "security.confirmKey": null } }
  );
  ctx.status = 200;
});

router.get("/:userId/api-errors", async (ctx) => {
  if (!(await collections.users.countDocuments({ _id: ctx.params.userId }, { limit: 1 }))) {
    return;
  }

  ctx.body = await ApiError.find({ user: ctx.params.userId }).sort("-createdAt").lean(true).limit(10);
});

router.get("/infoByName/:username", async (ctx) => {
  const user = await UserUtils.findByUsername(ctx.params.username);

  if (!user) {
    ctx.status = 404;
    return;
  }

  ctx.body = UserUtils.sanitize(user);
});

export default router;
