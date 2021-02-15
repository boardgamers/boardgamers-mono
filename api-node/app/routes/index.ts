import Router from "koa-router";
import account from "./account";
import admin from "./admin";
import boardgame from "./boardgame";
import game from "./game";
import page from "./pages";
import site from "./site";
import user from "./user";

const router = new Router();

router.use("/api/account", account.routes(), account.allowedMethods());
router.use("/api/admin", admin.routes(), admin.allowedMethods());
router.use("/api/game", game.routes(), game.allowedMethods());
router.use("/api/user", user.routes(), user.allowedMethods());
router.use("/api/site", site.routes(), site.allowedMethods());
router.use("/api/page", page.routes(), page.allowedMethods());
router.use("/api/boardgame", boardgame.routes(), boardgame.allowedMethods());

export default router;
