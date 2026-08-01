import type { Context } from "koa";
import Router from "koa-router";
import { z } from "zod";
import { colls } from "../../config/db.ts";
import { SettingsKey } from "../../models/index.ts";

const router = new Router<Application.DefaultState, Context>();

router.get("/announcement", async (ctx) => {
  ctx.body = (await colls.settings.findOne({ _id: SettingsKey.Announcement }))?.value;
});

const errorReportSchema = z.object({
  name: z.string().max(200).default("Error"),
  message: z.string().max(2000),
  stack: z.array(z.string().max(500)).max(50).default([]),
  url: z.string().max(500),
  gameId: z.string().max(100).optional(),
  release: z.string().max(100).optional(),
});

// POST /api/site/errors/report — client-side (browser) error reports. Auth-optional:
// logged-out users hit frontend errors too, so we accept anonymous reports. Stored in
// the same apierrors collection as server errors, tagged meta.source = "web-client".
router.post("/errors/report", async (ctx) => {
  const report = errorReportSchema.parse(ctx.request.body);

  await colls.apiErrors.insertOne({
    error: {
      name: report.name,
      message: report.message,
      stack: report.stack,
    },
    request: {
      url: report.url,
      method: "CLIENT",
      body: "",
    },
    user: ctx.state.user?._id,
    meta: {
      source: "web-client",
      userAgent: ctx.get("user-agent")?.slice(0, 300),
      gameId: report.gameId,
      release: report.release ?? process.env.APP_RELEASE,
    },
    createdAt: new Date(),
  });

  ctx.status = 204;
});

export default router;
