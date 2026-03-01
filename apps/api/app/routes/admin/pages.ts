import { omit } from "@bgs/utils/object";
import type { Context } from "koa";
import Router from "koa-router";
import { colls } from "../../config/db.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/", async (ctx) => {
  ctx.body = await colls.pages.find({}, { projection: { _id: 1 } }).toArray();
});

router.post("/:name/:lang", async (ctx) => {
  const page = await colls.pages.findOneAndUpdate(
    { _id: { name: ctx.params.name, lang: ctx.params.lang } },
    { $set: omit(ctx.request.body as Record<string, unknown>, "_id") },
    { upsert: true, returnDocument: "after" }
  );
  ctx.body = page;
});

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
