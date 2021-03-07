import { Context } from "koa";
import Router from "koa-router";
import { Settings, SettingsKey } from "../../models";

const router = new Router<Application.DefaultState, Context>();

router.get("/announcement", async (ctx) => {
  ctx.body = (await Settings.findById(SettingsKey.Announcement, null, { lean: true }))?.value;
});

export default router;
