import type { Context } from "koa";
import Router from "koa-router";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { findGameInfoWithVersion, findByUsername } from "../../models/index.ts";
import { queryCount } from "../utils.ts";

const router = new Router<Application.DefaultState, Context>();

const userSearchQuerySchema = z.object({
  query: z.string().optional(),
  mode: z.enum(["email", "username"]).optional(),
});

router.get("/search", async (ctx) => {
  const { query, mode } = userSearchQuerySchema.parse(ctx.query);

  if (!query) {
    ctx.body = [];
    return;
  }

  const conditions =
    mode === "email"
      ? { "account.email": new RegExp("^" + query.toLowerCase()) }
      : { "security.slug": new RegExp("^" + query.toLowerCase()) };

  const foundUsers = await colls.users
    .find(conditions, { projection: { account: 1 } })
    .limit(queryCount(ctx))
    .toArray();
  ctx.body = foundUsers;
});

router.post("/:userId", async (ctx) => {
  const { account } = z.object({ account: z.object({ karma: z.number() }) }).parse(ctx.request.body);
  await colls.users.updateOne(
    { _id: new ObjectId(ctx.params.userId) },
    {
      $set: { "account.karma": account.karma },
    },
  );
  ctx.status = 200;
});

router.post("/:userId/elo/:game", async (ctx) => {
  const { value } = z.object({ value: z.number() }).parse(ctx.request.body);
  await colls.gamePreferences.updateOne(
    { user: new ObjectId(ctx.params.userId), game: ctx.params.game },
    { $set: { "elo.value": value } },
    { upsert: false },
  );
  ctx.status = 200;
});

router.post("/:userId/access/grant", async (ctx) => {
  const { game, version } = z
    .object({
      type: z.literal("game"),
      game: z.string(),
      version: z.number().int(),
    })
    .parse(ctx.request.body);

  const gameInfo = await findGameInfoWithVersion(game, version);

  if (!gameInfo) {
    ctx.status = 404;
    return;
  }

  if (gameInfo.meta.public) {
    ctx.status = 200;
    return;
  }

  if (!(await colls.users.countDocuments({ _id: new ObjectId(ctx.params.userId) }))) {
    ctx.status = 404;
    return;
  }

  await colls.gamePreferences.updateOne(
    { user: new ObjectId(ctx.params.userId), game },
    { $set: { "access.maxVersion": gameInfo._id.version } },
    { upsert: true },
  );
  ctx.status = 200;
});

router.post("/:userId/confirm", async (ctx) => {
  if (!(await colls.users.countDocuments({ _id: new ObjectId(ctx.params.userId) }))) {
    return;
  }

  await colls.users.updateOne(
    { _id: new ObjectId(ctx.params.userId) },
    { $set: { "security.confirmed": true, "security.confirmKey": null } },
  );
  ctx.status = 200;
});

router.get("/:userId/api-errors", async (ctx) => {
  if (!(await colls.users.countDocuments({ _id: new ObjectId(ctx.params.userId) }))) {
    return;
  }

  ctx.body = await colls.apiErrors
    .find({ user: new ObjectId(ctx.params.userId) })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();
});

router.get("/infoByName/:username", async (ctx) => {
  const user = await findByUsername(ctx.params.username);

  if (!user) {
    ctx.status = 404;
    return;
  }

  ctx.body = user;
});

export default router;
