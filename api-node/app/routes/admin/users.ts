import assert from "assert";
import { Context } from "koa";
import Router from "koa-router";
import ApiError from "../../models/apierror";
import GameInfo from "../../models/gameinfo";
import GamePreferences from "../../models/gamepreferences";
import User from "../../models/user";

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

  const users = await User.find(conditions, "account").lean(true).limit(50);
  ctx.body = users;
});

router.post("/:userId", async (ctx) => {
  await User.updateOne(
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

  const gameInfo = await GameInfo.findWithVersion(ctx.request.body.game, ctx.request.body.version).lean(true);

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
    { user: ctx.params.userId, game: ctx.request.body.game },
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
  const user = await User.findByUsername(ctx.params.username);

  if (!user) {
    ctx.status = 404;
    return;
  }

  ctx.body = user;
});

export default router;
