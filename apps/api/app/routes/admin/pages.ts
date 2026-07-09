import { omit } from "@bgs/utils/object";
import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { colls } from "../../config/db.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/", async (ctx) => {
  ctx.body = await colls.pages.find({}, { projection: { _id: 1 } }).toArray();
});

async function upsert(ctx: Context) {
  const page = await colls.pages.findOneAndUpdate(
    { _id: { name: ctx.params.name, lang: ctx.params.lang } },
    { $set: omit(z.record(z.string(), z.unknown()).parse(ctx.request.body), "_id") },
    { upsert: true, returnDocument: "after" },
  );
  ctx.body = page;
}

// oxlint-disable no-async-endpoint-handlers -- Express-specific rule; Koa awaits async middleware natively
router.post("/:name/:lang", upsert);
router.put("/:name/:lang", upsert);
// oxlint-enable no-async-endpoint-handlers

router.delete("/:name/:lang", async (ctx) => {
  await colls.pages.deleteOne({
    _id: {
      name: ctx.params.name,
      lang: ctx.params.lang,
    },
  });
  ctx.status = 200;
});

export default router;
