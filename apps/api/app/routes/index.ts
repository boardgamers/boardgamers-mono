import type { Context } from "koa";
import Router from "koa-router";
import account from "./account/index.ts";
import admin from "./admin/index.ts";
import boardgame from "./boardgame/index.ts";
import game from "./game/index.ts";
import page from "./pages/index.ts";
import site from "./site/index.ts";
import user from "./user/index.ts";

const router = new Router<Application.DefaultState, Context>();

router.use("/api/account", account.routes(), account.allowedMethods());
router.use("/api/admin", admin.routes(), admin.allowedMethods());
router.use("/api/game", game.routes(), game.allowedMethods());
router.use("/api/user", user.routes(), user.allowedMethods());
router.use("/api/site", site.routes(), site.allowedMethods());
router.use("/api/page", page.routes(), page.allowedMethods());
router.use("/api/boardgame", boardgame.routes(), boardgame.allowedMethods());

export default router;
