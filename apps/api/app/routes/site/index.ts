import type { Context } from "koa";
import Router from "koa-router";
import { colls } from "../../config/db.ts";
import { SettingsKey } from "../../models/index.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/announcement", async (ctx) => {
  ctx.body = (await colls.settings.findOne({ _id: SettingsKey.Announcement }))?.value;
});

export default router;
