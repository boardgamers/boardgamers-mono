import { omit } from "@bgs/utils/object";
import type { Context } from "koa";
import Router from "koa-router";
import { GameInfo } from "../../models/index.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/", async (ctx) => {
  ctx.body = await GameInfo.find({}, "_id").lean(true).sort("_id.game -_id.version");
});

router.post("/:game/:version", async (ctx) => {
  const game = await GameInfo.findByIdAndUpdate(
    {
      game: ctx.params.game,
      version: +ctx.params.version,
    },
    omit(ctx.request.body as Record<string, unknown>, "_id"),
    {
      upsert: true,
      runValidators: true,
    }
  );
  ctx.body = game;
});

router.get("/:game/:version", async (ctx) => {
  const game = await GameInfo.findById({ game: ctx.params.game, version: +ctx.params.version }).lean(true);

  if (game) {
    ctx.body = game;
  } // else 404
});

export default router;
