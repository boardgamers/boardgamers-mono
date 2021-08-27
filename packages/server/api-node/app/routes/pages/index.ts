import { Context } from "koa";
import Router from "koa-router";
import { Page } from "../../models";

const router = new Router<Application.DefaultState, Context>();

// router.get('/', async (ctx) => {
//   ctx.body = await GameInfo.find({"meta.public": true}, "-viewer", {lean: true}).sort("-_id.game -_id.version");
// });

router.get("/:page", async (ctx) => {
  // Todo: add query params & do language matching
  const page = await Page.findOne({ "_id.name": ctx.params.page, "_id.lang": "en" });

  if (page) {
    ctx.body = page;
  } // else 404
});

router.get("/:page/:lang", async (ctx) => {
  const page = await Page.findById({ name: ctx.params.page, lang: ctx.params.lang });

  if (page) {
    ctx.body = page;
  } // else 404
});

export default router;
