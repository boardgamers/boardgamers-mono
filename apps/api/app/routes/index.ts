import type { Context } from "koa";
import Router from "koa-router";
import account from "./account/index.ts";
import admin from "./admin/index.ts";
import auth from "./auth.ts";
import boardgame from "./boardgame/index.ts";
import feedback from "./feedback/index.ts";
import game from "./game/index.ts";
import oauth2 from "./oauth2/index.ts";
import page from "./pages/index.ts";
import site from "./site/index.ts";
import user from "./user/index.ts";

const router = new Router<Application.DefaultState, Context>();

// Liveness probe for the watchdog (scripts/watchdog.ts): 200 as long as the event
// loop serves HTTP. Deliberately does NOT touch the DB — a slow db must not read as
// "hung" and trigger a restart.
router.get("/health", (ctx) => {
	ctx.body = { ok: true, uptime: process.uptime() };
});

// Social-OAuth start + callback live at the top level, not under /api (#248).
// nginx must route /auth/* to the api for these to be reachable on the public origin.
router.use("/auth", auth.routes(), auth.allowedMethods());
router.use("/api/account", account.routes(), account.allowedMethods());
router.use("/api/admin", admin.routes(), admin.allowedMethods());
router.use("/api/oauth2", oauth2.routes(), oauth2.allowedMethods());
router.use("/api/game", game.routes(), game.allowedMethods());
router.use("/api/user", user.routes(), user.allowedMethods());
router.use("/api/site", site.routes(), site.allowedMethods());
router.use("/api/page", page.routes(), page.allowedMethods());
router.use("/api/boardgame", boardgame.routes(), boardgame.allowedMethods());
router.use("/api/feedback", feedback.routes(), feedback.allowedMethods());

export default router;
