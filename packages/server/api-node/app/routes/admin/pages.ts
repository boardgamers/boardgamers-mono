import { Context } from "koa";
import Router from "koa-router";
import { omit } from "lodash";
import { Page } from "../../models";

const router = new Router<Application.DefaultState, Context>();

router.get("/", async (ctx) => {
  ctx.body = await Page.find({}, "_id").lean(true);
});

router.post("/:name/:lang", async (ctx) => {
  const page = await Page.findByIdAndUpdate(
    {
      name: ctx.params.name,
      lang: ctx.params.lang,
    },
    omit(ctx.request.body, "_id"),
    {
      upsert: true,
      runValidators: true,
    }
  );
  ctx.body = page;
});

router.delete("/:name/:lang", async (ctx) => {
  await Page.deleteOne({
    name: ctx.params.name,
    lang: ctx.params.lang,
  });
  ctx.status = 200;
});

export default router;
